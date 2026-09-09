import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { getTenantConfig } from "@/lib/tenantConfig";

// DLP/LOS integration Phase 5 — tenant branding config, Approver-only
// write, same auth posture as api/staff/feature-settings (staffRole
// trusted from the request body, not re-verified server-side against a
// real session — this app's whole prototype-grade auth story, see
// README's "Known gaps"). GET returns the current config; PUT updates it
// and optionally replaces the logo image (multipart, since this is the
// one staff-config endpoint that also takes a file).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export async function GET() {
  const config = await getTenantConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const form = await req.formData();
  const staffName = form.get("staffName") as string | null;
  const staffRole = form.get("staffRole") as string | null;
  const displayName = (form.get("displayName") as string | null)?.trim();
  const shortName = (form.get("shortName") as string | null)?.trim();
  const primaryColor = form.get("primaryColor") as string | null;
  const accentColor = form.get("accentColor") as string | null;
  const neutralColor = form.get("neutralColor") as string | null;
  const defaultTheme = form.get("defaultTheme") as string | null;
  const logo = form.get("logo") as File | null;

  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can update tenant branding." }, { status: 403 });
  }
  if (!displayName || !shortName) {
    return NextResponse.json({ error: "displayName and shortName are required." }, { status: 400 });
  }
  for (const [label, value] of [["primaryColor", primaryColor], ["accentColor", accentColor], ["neutralColor", neutralColor]] as const) {
    if (!value || !HEX_COLOR_RE.test(value)) {
      return NextResponse.json({ error: `${label} must be a 6-digit hex color like #1cb27d.` }, { status: 400 });
    }
  }
  if (defaultTheme !== "light" && defaultTheme !== "dark") {
    return NextResponse.json({ error: "defaultTheme must be 'light' or 'dark'." }, { status: 400 });
  }

  const current = await getTenantConfig();
  let logoUrl = current.logoUrl;

  if (logo && logo.size > 0) {
    if (logo.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo is too large — please upload something under 5MB." }, { status: 413 });
    }
    const ext = ALLOWED_LOGO_TYPES[logo.type];
    if (!ext) {
      return NextResponse.json({ error: "Logo must be PNG, JPEG, WebP, or SVG." }, { status: 415 });
    }
    const dir = path.join(process.cwd(), "public", "logos");
    await mkdir(dir, { recursive: true });
    const fileName = `tenant-logo-${nanoid(8)}.${ext}`;
    const bytes = Buffer.from(await logo.arrayBuffer());
    await writeFile(path.join(dir, fileName), bytes);

    // Clean up the previous uploaded logo (never the bundled default —
    // that one isn't tracked in logoUrl, only an actually-uploaded one
    // ever is, per the model's own doc comment).
    if (current.logoUrl) {
      try {
        await unlink(path.join(process.cwd(), "public", current.logoUrl.replace(/^\//, "")));
      } catch {
        // Already missing/removed — not fatal, we're about to overwrite
        // the reference to it anyway.
      }
    }
    logoUrl = `/logos/${fileName}`;
  }

  const updated = await db.tenantConfig.upsert({
    where: { id: "global" },
    create: { id: "global", displayName, shortName, logoUrl, primaryColor: primaryColor!, accentColor: accentColor!, neutralColor: neutralColor!, defaultTheme, updatedBy: staffName ?? null },
    update: { displayName, shortName, logoUrl, primaryColor: primaryColor!, accentColor: accentColor!, neutralColor: neutralColor!, defaultTheme, updatedBy: staffName ?? null },
  });

  return NextResponse.json({ config: updated });
}
