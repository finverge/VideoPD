// One-time addition: adds one income-focused VideoPD Q&A question per
// segment, so the Live Consistency Engine's Q&A-side check (BR-42, see
// src/lib/mockChecks.ts's isIncomeQuestion) has a real question to activate
// against — none of the 9 originally-seeded questions (seed-videopd-
// questions.js) ask about income at all, so without this the check would
// never fire on the current stock question bank.
//
// Runs through the same real pipeline an admin drafting a question through
// /staff/questions uses (src/lib/translate.ts's translateToAllLanguages —
// MyMemory's free API), not hand-typed regional-language text. Seeded
// directly as APPROVED, same precedent as the original 9 (they were already
// live before the DB-backed question bank existed, so were seeded
// pre-approved rather than sitting in DRAFT needing a staff review pass).
//
// Idempotent — skips any (segment, key) pair that already exists.
import { PrismaClient } from "@prisma/client";
import { translateToAllLanguages } from "../src/lib/translate";

const db = new PrismaClient();

const QUESTIONS = [
  {
    segment: "FARMER" as const, key: "monthlyIncome", orderIndex: 3,
    promptEn: "Roughly how much do you earn from farming and other work in a typical month?",
  },
  {
    segment: "VOCATIONAL_STUDENT" as const, key: "monthlyIncome", orderIndex: 3,
    promptEn: "What's your, or your family's, approximate monthly income right now?",
  },
  {
    segment: "BUSINESS_OWNER" as const, key: "monthlyIncome", orderIndex: 3,
    promptEn: "Roughly what's your business's average monthly income?",
  },
];

async function main() {
  let created = 0, skipped = 0;
  for (const q of QUESTIONS) {
    const existing = await db.videoPdQuestionConfig.findUnique({
      where: { segment_key: { segment: q.segment, key: q.key } },
    });
    if (existing) { skipped++; console.log(`skip  ${q.segment}/${q.key} (already exists)`); continue; }

    const translations = await translateToAllLanguages(q.promptEn);
    const warnings = Object.entries(translations).filter(([, r]) => !r.ok).map(([lang]) => lang);
    if (warnings.length > 0) console.log(`  translation warnings for ${q.segment}/${q.key}: ${warnings.join(", ")} (left blank, falls back to English at display time)`);

    await db.videoPdQuestionConfig.create({
      data: {
        segment: q.segment, key: q.key, orderIndex: q.orderIndex,
        status: "APPROVED",
        promptEn: q.promptEn,
        promptHi: translations.hi.ok ? translations.hi.text : null,
        promptTe: translations.te.ok ? translations.te.text : null,
        promptTa: translations.ta.ok ? translations.ta.text : null,
        promptKn: translations.kn.ok ? translations.kn.text : null,
        promptMl: translations.ml.ok ? translations.ml.text : null,
        createdBy: "system-seed",
        approvedBy: "system-seed",
        approvedAt: new Date(),
      },
    });
    created++;
    console.log(`created ${q.segment}/${q.key}: "${q.promptEn}"`);
  }
  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
}

main().finally(() => db.$disconnect());
