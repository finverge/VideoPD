import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractFieldValue, fieldLabel, fieldPrompt, resolveConfirmIntent, matchFaq } from "@/lib/dialogManager";
import { t } from "@/lib/i18n";
import type { LangCode, SegmentCode } from "@/types";

interface ChatRequestBody {
  applicationId: string;
  language: LangCode;
  channel: "voice" | "text";
  userText: string;
  segment?: SegmentCode | null;
  pendingFieldKey?: string | null;
  awaitingConfirmField?: string | null;
  awaitingConfirmValue?: string | number | null;
  awaitingConfirmDisplay?: string | null;
}

// Returns this application's persisted chat history — lets ChatPanel
// rehydrate the actual conversation on mount instead of starting fresh
// every time. Found live: the mobile chat sheet fully unmounts on close
// (tapping the backdrop, the X button) and remounts from scratch on
// reopen, silently discarding the entire conversation shown so far — a
// borrower mid-way through answering questions would see the chat jump
// straight back to the generic greeting, no memory of anything already
// asked or answered, from something as ordinary as an accidental tap
// outside the sheet. The desktop panel never hit this (stays mounted
// continuously), which is why it wasn't caught earlier.
export async function GET(req: NextRequest) {
  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  const turns = await db.chatTurn.findMany({
    where: { applicationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, channel: true, text: true, createdAt: true },
  });
  return NextResponse.json({ turns });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequestBody;
  const { applicationId, language, channel, userText } = body;
  const segment = body.segment ?? undefined;

  if (!applicationId || !userText) {
    return NextResponse.json({ error: "applicationId and userText are required." }, { status: 400 });
  }

  await db.chatTurn.create({
    data: { applicationId, role: "user", channel, language, text: userText },
  });

  let assistantText = "";
  let fieldUpdate: { key: string; value: string | number; displayValue: string } | null = null;
  let requiresConfirmation: { fieldKey: string; value: string | number; displayValue: string } | null = null;
  let escalate = false;

  // 1) Resolving a pending yes/no confirmation (FR-CHB-07 read-back)
  if (body.awaitingConfirmField && body.awaitingConfirmValue !== undefined && body.awaitingConfirmValue !== null) {
    // resolveConfirmIntent tries the fast native-language/English match
    // first (no network call), and only falls back to translating the
    // reply to English when that's ambiguous — covers code-mixed replies
    // ("సేవ్ చేయండి." for "save it") a hand-curated word list per language
    // can't realistically enumerate in full. See its own doc comment.
    const intent = await resolveConfirmIntent(userText, language);
    if (intent === "yes") {
      fieldUpdate = {
        key: body.awaitingConfirmField,
        value: body.awaitingConfirmValue,
        displayValue: body.awaitingConfirmDisplay ?? String(body.awaitingConfirmValue),
      };
      assistantText = "Saved. Let's continue.";
    } else if (intent === "no") {
      assistantText = `${t(language, "chatConfirmNo")}. ${fieldPrompt(body.awaitingConfirmField, language, segment)}`;
    } else {
      // Unclear — re-ask the yes/no question rather than guessing (FR-CHB-04 spirit).
      // Must also echo `requiresConfirmation` back: the client (ChatPanel) only
      // keeps its pendingConfirm state alive when this field is present on the
      // response. Without it, the client saw fieldUpdate=null and
      // requiresConfirmation=null here, read that as "conversation moved on",
      // and cleared pendingConfirm — so the *next* reply (which was actually
      // still answering this same yes/no question) got treated as a brand-new
      // raw value for the field instead, and re-confirmed with garbage like
      // "Full name is Should I save that? No." (the previous prompt's own text).
      assistantText = t(language, "chatConfirmField", {
        field: fieldLabel(body.awaitingConfirmField, language, segment),
        value: body.awaitingConfirmDisplay ?? String(body.awaitingConfirmValue),
      });
      requiresConfirmation = {
        fieldKey: body.awaitingConfirmField,
        value: body.awaitingConfirmValue,
        displayValue: body.awaitingConfirmDisplay ?? String(body.awaitingConfirmValue),
      };
    }
  }
  // 2) Actively trying to fill a specific field — but a genuine question (FR-CHB-03)
  // should still get answered rather than be force-fit as a field value.
  else if (body.pendingFieldKey) {
    const faqAnswer = /\?|^(what|how|why|when|who|is there|do i|does)\b/i.test(userText.trim())
      ? matchFaq(userText, language)
      : null;

    if (faqAnswer) {
      assistantText = `${faqAnswer} ${fieldPrompt(body.pendingFieldKey, language, segment)}`;
    } else {
      const result = extractFieldValue(body.pendingFieldKey, userText, language, segment);
      if (result.ok && result.value !== null) {
        requiresConfirmation = { fieldKey: body.pendingFieldKey, value: result.value, displayValue: result.displayValue };
        assistantText = t(language, "chatConfirmField", {
          field: fieldLabel(body.pendingFieldKey, language, segment),
          value: result.displayValue,
        });
      } else {
        assistantText = `Sorry, I didn't quite catch that. ${fieldPrompt(body.pendingFieldKey, language, segment)}`;
        escalate = true; // signal client to offer human escalation after a second miss (FR-CHB-04)
      }
    }
  }
  // 3) Free-form question — try FAQ, else general help
  else {
    const faqAnswer = matchFaq(userText, language);
    assistantText = faqAnswer ?? t(language, "chatGreeting", { lang: language.toUpperCase() });
  }

  await db.chatTurn.create({
    data: {
      applicationId,
      role: "assistant",
      channel,
      language,
      text: assistantText,
      fieldUpdated: fieldUpdate?.key ?? null,
    },
  });

  return NextResponse.json({ assistantText, fieldUpdate, requiresConfirmation, escalate });
}
