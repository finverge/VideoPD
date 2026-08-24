import type { LangCode } from "@/types";

/**
 * Real machine translation via MyMemory's free, keyless API — no vendor
 * credentials needed, which matters for a local prototype. Used both
 * directions: English -> the other 5 languages when an admin drafts a new
 * VideoPD question (src/app/api/staff/questions/route.ts), and
 * borrower-language -> English for the underwriter dossier's bilingual
 * transcript (BRD BR-45, src/app/api/videopd/[token]/complete/route.ts).
 *
 * Honest about failure: MyMemory is a free/rate-limited service, so a
 * translation can legitimately fail (network issue, quota). Callers get
 * `ok: false` and the original text back — never a silently wrong or
 * fabricated translation standing in for a real one.
 */

const MYMEMORY_LANG: Record<LangCode, string> = {
  en: "en", hi: "hi", te: "te", ta: "ta", kn: "kn", ml: "ml",
};

export interface TranslationResult {
  text: string;
  ok: boolean;
}

export async function translateText(text: string, sourceLang: LangCode, targetLang: LangCode): Promise<TranslationResult> {
  const trimmed = text.trim();
  if (!trimmed) return { text: "", ok: true };
  if (sourceLang === targetLang) return { text: trimmed, ok: true };

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${MYMEMORY_LANG[sourceLang]}|${MYMEMORY_LANG[targetLang]}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { text: trimmed, ok: false };
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated || typeof translated !== "string") return { text: trimmed, ok: false };
    return { text: translated, ok: true };
  } catch {
    return { text: trimmed, ok: false };
  }
}

/** Translates one English source string into every other launch language.
 * Used when an admin drafts a new VideoPD question in English — auto-fills
 * the other five as a starting point for review, never as a final answer;
 * the admin can still edit any of them before approving. */
export async function translateToAllLanguages(englishText: string): Promise<Record<Exclude<LangCode, "en">, TranslationResult>> {
  const targets: Exclude<LangCode, "en">[] = ["hi", "te", "ta", "kn", "ml"];
  const results = await Promise.all(targets.map((lang) => translateText(englishText, "en", lang)));
  return Object.fromEntries(targets.map((lang, i) => [lang, results[i]])) as Record<Exclude<LangCode, "en">, TranslationResult>;
}
