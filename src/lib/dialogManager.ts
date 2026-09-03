import type { LangCode, SegmentCode } from "@/types";
import { findFieldDef } from "@/lib/formSchema";
import { t } from "@/lib/i18n";

/**
 * Rule-based Dialog Manager for the local prototype (FSD Section 5, FR-CHB-06/07).
 *
 * Production replaces the extraction/intent logic here with the NLU pipeline
 * named in FIN-HLD-VIDEOPD-2.0 Section 4.2 — this module's function signatures
 * are the seam: `extractFieldValue` and `matchFaq` are what a real NLU service
 * would implement behind the same contract.
 */

export interface ExtractionResult {
  ok: boolean;
  value: string | number | null;
  displayValue: string;
}

const YES_WORDS = [
  // "save"/"confirm"/"done" added — real replies people actually send
  // ("Save it.", "confirm", "done") that were never recognized because they
  // don't contain any literal yes/yeah/ok/etc. word at all, a different gap
  // from the word-boundary issue below.
  "yes", "yeah", "yep", "correct", "right", "haan", "ok", "okay", "sure", "save", "confirm", "confirmed", "done",
  "हाँ", "हां", "ठीक", // hi
  // te: అవును/సరే are the "proper" words; సేవ్/యెస్ are phonetic
  // transliterations of the English "save"/"yes" typed in Telugu script —
  // confirmed live (reported with a screenshot): a borrower typed exactly
  // "సేవ్ చేయండి." ("save cheyandi" — Telugu-English code-mixing, extremely
  // common in real usage) and "యెస్." and neither matched anything here.
  "అవును", "సరే", "సేవ్", "యెస్",
  "ஆம்", "சரி", // ta
  "ಹೌದು", "ಸರಿ", // kn
  "അതെ", "ശരി", // ml
];
const NO_WORDS = [
  "no", "nope", "wrong", "nahi", "incorrect", "redo", "cancel",
  "नहीं", "गलत", // hi
  "కాదు", "తప్పు", // te
  "இல்லை", "தவறு", // ta
  "ಇಲ್ಲ", "ತಪ್ಪು", // kn
  "അല്ല", "തെറ്റ്", // ml
];

// Splits into whole "words" for any script, not just Latin — the previous
// approach here (and separately, extractFieldValue's choice matcher below)
// used JS regex \b word-boundaries, which turn out to flatly not work on
// Devanagari/Telugu/Tamil/Kannada/Malayalam text at all: \b is defined
// relative to \w (Latin letters/digits/underscore only), so a script where
// *no* character is \w has no \b boundary anywhere in it — confirmed live,
// /\bहाँ\b/i.test("मुझे हाँ चाहिए") is false. That's not a partial-match
// gap, it's total: every non-English YES_WORDS/NO_WORDS entry, and every
// non-English choice label match in extractFieldValue, was silently
// unmatchable regardless of position. Splitting on "anything that isn't a
// Unicode letter or number" (\p{L}/\p{N} with the u flag) sidesteps \w
// entirely.
//
// That \p{L}/\p{N} fix turned out to be only half right, and the second
// half was far worse — confirmed in a real multi-language end-to-end test
// run: EVERY Devanagari/Telugu/Tamil/Kannada/Malayalam word that uses a
// combining vowel sign (a matra — extremely common; these are all abugida
// scripts where a vowel attached to a consonant is usually written as a
// mark on that consonant, not its own letter) was getting silently
// shredded. A combining mark's Unicode category is Mn ("Mark, nonspacing")
// or Mc ("Mark, spacing combining") — neither is \p{L} or \p{N} — so the
// old regex split ON it, throwing the vowel sign away entirely: "दो" ("two"
// — द + a ो matra) tokenized to just "द", and "मेरे" ("my" — मे + रे, two
// matra-bearing syllables) fell apart into "म" and "र". This wasn't a
// partial gap either — it silently broke almost every real word in these
// five scripts, not just edge cases, so it's exactly the kind of thing an
// isolated unit test of one hand-picked "clean" phrase could pass while
// real sentences failed constantly. \p{M} is the umbrella Unicode category
// for exactly these combining marks (Mn + Mc + Me); including it in the
// "keep, don't split" set is what makes tokenize() actually word-aware for
// these scripts rather than just script-aware.
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

// True if `phrase`'s own tokens appear as a contiguous run inside `tokens`
// — handles both single-word candidates ("save", "yes") and multi-word ones
// ("voter id") the same way, anywhere in the text, not just as a prefix.
// Anywhere-matching (not just "starts with") is what "Save it." and "That
// yes." both need — the previous prefix-only check missed both.
function containsPhrase(tokens: string[], phrase: string): boolean {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0) return false;
  for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
    if (phraseTokens.every((t, j) => tokens[i + j] === t)) return true;
  }
  return false;
}

export function isAffirmative(text: string): boolean {
  const tokens = tokenize(text);
  return YES_WORDS.some((w) => containsPhrase(tokens, w));
}
export function isNegative(text: string): boolean {
  const tokens = tokenize(text);
  return NO_WORDS.some((w) => containsPhrase(tokens, w));
}

/**
 * Same translation-fallback technique as resolveConfirmIntent below, applied
 * to the earlier step: extracting a value at all, not just confirming one.
 * Reported live ("catching of the Gender and other words also still some
 * confusion") after resolveConfirmIntent already fixed the yes/no
 * confirmation step the same way — the identical structural gap existed one
 * step earlier: extractFieldValue's choice-matching only ever tried the
 * native-language/English label list, with no fallback for a genuine reply
 * that doesn't happen to be in it. Only applies to choice-type fields (a
 * translated number or free-text answer wouldn't parse any more reliably
 * than the original — translation only helps when what's being matched is
 * a small, known set of labels).
 */
export async function resolveFieldValue(
  fieldKey: string,
  raw: string,
  lang: LangCode = "en",
  segment?: SegmentCode
): Promise<ExtractionResult> {
  const direct = extractFieldValue(fieldKey, raw, lang, segment);
  if (direct.ok || lang === "en") return direct;

  const field = findFieldDef(fieldKey, segment);
  if (field?.type !== "choice" || !field.choices) return direct;

  const { translateText } = await import("@/lib/translate");
  const translation = await translateText(raw, lang, "en");
  if (!translation.ok) return direct;

  const viaEnglish = extractFieldValue(fieldKey, translation.text, "en", segment);
  if (!viaEnglish.ok) return direct;

  // Re-derive the display value in the borrower's OWN language (not the
  // English one extractFieldValue just matched against), so the confirm
  // read-back stays consistent with the rest of the conversation.
  const matchedChoice = field.choices.find((c) => c.value === viaEnglish.value);
  if (!matchedChoice) return direct;
  return { ok: true, value: viaEnglish.value, displayValue: t(lang, matchedChoice.labelKey) };
}

/**
 * Resolves a yes/no/unclear confirmation reply, same as isAffirmative/
 * isNegative but with a real fallback for the case those two structurally
 * can't cover: hand-curated word lists per language can never be complete
 * against genuine Indian-language digital communication, which routinely
 * code-mixes English words phonetically into the local script rather than
 * using the "proper" native word — confirmed live in Telugu ("సేవ్
 * చేయండి." for "save it", "యెస్." for "yes"), and there's no principled
 * reason it wouldn't happen the same way in Hindi/Tamil/Kannada/Malayalam
 * too, just not yet reported. Enumerating every plausible transliteration
 * by hand across five scripts isn't reliable without a native speaker to
 * verify each one — this app already has a real, working translation
 * pipeline (lib/translate.ts, used for the bilingual dossier transcript),
 * so instead: try the fast native-language/English match first (no network
 * call, covers the common case instantly), and only if that's ambiguous,
 * translate the reply to English and match again there — which is exactly
 * as reliable as this codebase's English word list already is, for
 * whatever the borrower actually wrote, not just what happened to be
 * anticipated in a list.
 */
export async function resolveConfirmIntent(text: string, lang: LangCode): Promise<"yes" | "no" | "unclear"> {
  if (isAffirmative(text)) return "yes";
  if (isNegative(text)) return "no";
  if (lang === "en") return "unclear";

  const { translateText } = await import("@/lib/translate");
  const result = await translateText(text, lang, "en");
  if (!result.ok) return "unclear"; // translation failure is honestly "couldn't tell", not a guessed answer
  if (isAffirmative(result.text)) return "yes";
  if (isNegative(result.text)) return "no";
  return "unclear";
}

// Indic digit blocks → Latin 0-9, so "౫౦౦౦౦" / "५०,०००" parse the same as "50000".
// Covers Devanagari, Telugu, Tamil, Kannada, Malayalam digit code points.
const INDIC_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  "౦": "0", "౧": "1", "౨": "2", "౩": "3", "౪": "4", "౫": "5", "౬": "6", "౭": "7", "౮": "8", "౯": "9",
  "௦": "0", "௧": "1", "௨": "2", "௩": "3", "௪": "4", "௫": "5", "௬": "6", "௭": "7", "௮": "8", "௯": "9",
  "೦": "0", "೧": "1", "೨": "2", "೩": "3", "೪": "4", "೫": "5", "೬": "6", "೭": "7", "೮": "8", "೯": "9",
  "൦": "0", "൧": "1", "൨": "2", "൩": "3", "൪": "4", "൫": "5", "൬": "6", "൭": "7", "൮": "8", "൯": "9",
};
function normalizeDigits(text: string): string {
  return text.replace(/[०-९౦-౯௦-௯೦-೯൦-൯]/g, (ch) => INDIC_DIGITS[ch] ?? ch);
}

// Amount multiplier words per language — the realistic way Indian borrowers state
// amounts by voice ("50 లక్షలు", "२ लाख ५० हज़ार"), not fully spelled-out number words.
const MULTIPLIER_WORDS: Record<LangCode, { words: string[]; value: number }[]> = {
  en: [
    { words: ["crore", "crores"], value: 10000000 },
    { words: ["lakh", "lakhs", "lac", "lacs"], value: 100000 },
    { words: ["thousand"], value: 1000 },
  ],
  hi: [
    { words: ["करोड़", "करोड"], value: 10000000 },
    { words: ["लाख"], value: 100000 },
    { words: ["हज़ार", "हजार"], value: 1000 },
  ],
  te: [
    { words: ["కోట్లు", "కోటి"], value: 10000000 },
    // "లక్షల" (the oblique/genitive-ish form used right before a following
    // number, "...lakh(s)-of...") added alongside "లక్ష"/"లక్షలు" — confirmed
    // needed live, and confirms something important about the earlier fix
    // in parseAmountWithMultipliers requiring a real word boundary after
    // the matched word: before that fix, "లక్ష" silently matched as a
    // substring PREFIX of "లక్షల" too, and happened to still total
    // correctly here purely because this particular suffix is a case
    // marker that doesn't change the multiplier's value — not because the
    // old matching was actually correct. It was the same unsafe mechanism
    // that produced a genuinely wrong total for Malayalam's combining form
    // in the same test run, just luckier here. Adding the real word is the
    // honest fix; relying on the coincidence would leave a landmine for
    // the next inflected form that ISN'T value-preserving.
    { words: ["లక్షలు", "లక్షల", "లక్ష"], value: 100000 },
    { words: ["వేలు", "వేల"], value: 1000 },
  ],
  ta: [
    { words: ["கோடி"], value: 10000000 },
    // Deliberately NOT adding "லட்சத்து" (the combining form confirmed live
    // right before a following number, e.g. "இரண்டு லட்சத்து ஐம்பதாயிரம்" —
    // "two lakh fifty thousand") even though it's a real word: unlike
    // Telugu's "లక్షల" above, the number that follows it in real usage is
    // itself commonly a single FUSED compound word ("ஐம்பதாயிரம்" =
    // "fifty-thousand" as one token, not "50" + "ஆயிரம்"), which this
    // parser has no way to decompose. Adding just the combining form would
    // make the multiplier match "succeed" on the lakh portion alone and
    // silently drop the fused thousand portion — a real ₹2,50,000 becoming
    // a wrong-but-confident ₹2,00,000, the exact bug just fixed for
    // Malayalam's identical pattern. Safer to leave this an honest failure
    // (containsMultiplierHint still catches "லட்ச" as a hint and blocks the
    // bare-digit fallback too) until the fused-compound-number problem
    // itself has a real solution.
    { words: ["இலட்சம்", "லட்சம்"], value: 100000 },
    { words: ["ஆயிரம்"], value: 1000 },
  ],
  kn: [
    { words: ["ಕೋಟಿ"], value: 10000000 },
    // "ಲಕ್ಷದ" — same oblique/genitive-form reasoning as Telugu's "లక్షల"
    // above, confirmed needed by the same live test.
    { words: ["ಲಕ್ಷ", "ಲಕ್ಷದ"], value: 100000 },
    { words: ["ಸಾವಿರ"], value: 1000 },
  ],
  ml: [
    { words: ["കോടി"], value: 10000000 },
    { words: ["ലക്ഷം", "ലക്ഷ"], value: 100000 },
    { words: ["ആയിരം"], value: 1000 },
  ],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Spelled-out number words, for small "number" fields (years in operation,
// number of employees, dependents...) where a borrower's spoken or typed
// answer is far more likely to be a word than a digit for anything under
// ten. Confirmed a real, reproducible failure live: "Zero years.", "Yeah,
// one year." etc. all failed outright — the number branch below only ever
// looked for a literal digit character.
//
// Confirmed the identical failure in a real end-to-end test run across all
// five non-English launch languages too ("मेरे दो बच्चे हैं" / "నాకు ఇద్దరు
// పిల్లలు ఉన్నారు" / "எனக்கு இரண்டு குழந்தைகள் உள்ளன" / "ನನಗೆ ಇಬ್ಬರು
// ಮಕ್ಕಳಿದ್ದಾರೆ" / "എനിക്ക് രണ്ട് കുട്ടികളുണ്ട്" — all "I have two children"
// — every one of them failed the same way English did before this fix) —
// so this covers all six languages, not just English.
//
// Deliberately NOT a complete 0-99 table for every language: Hindi's
// 21-99 range is mostly unique irregular words per number (not a clean
// "twenty" + "five" compound the way English or the four Dravidian
// languages here are), and hand-typing ~80 more irregular words per
// language without native-speaker verification risked shipping wrong
// vocabulary silently accepted as correct — worse than the honest "doesn't
// match, re-asks" failure this whole file otherwise prefers. Each
// language's `ones` covers 0-19 plus (for the four languages that actually
// compound tens+ones regularly) `tens` for the round tens 20-90, with
// `compounds: true` enabling the same "tens ones" -> tens+ones logic
// English uses. Hindi's tens are listed as their own words with `compounds:
// false` (correct as bare round numbers — 20, 30, 40... — but 21-99
// in between stay an honest, documented gap). Also includes common
// PERSON-COUNTING classifier forms (Telugu "ఇద్దరు", Kannada "ಇಬ್ಬರು" for
// "two people") alongside the bare numeral, since "how many dependents" is
// exactly the kind of question that elicits them in natural speech —
// confirmed live in the same test run.
//
// None of this vocabulary has been checked by a native speaker of each
// language — same caveat this codebase's own i18n.ts translations already
// carry (docs/videopd-future-work.md's "translations need a native-speaker
// QA pass" item applies here too). Extend/correct per-language as that
// review happens.
interface NumberWordConfig {
  ones: Record<string, number>;
  tens: Record<string, number>;
  compounds: boolean;
}
const NUMBER_WORDS: Record<LangCode, NumberWordConfig> = {
  en: {
    ones: {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    },
    tens: { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
    compounds: true,
  },
  hi: {
    ones: {
      "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6,
      "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14,
      "पंद्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19,
    },
    // Round tens only — not compounded with ones (21-99 are mostly their
    // own irregular words in Hindi, not "बीस" + "एक"; see doc comment above).
    tens: { "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90 },
    compounds: false,
  },
  te: {
    ones: {
      "సున్నా": 0, "ఒకటి": 1, "రెండు": 2, "ఇద్దరు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5, "ఆరు": 6,
      "ఏడు": 7, "ఎనిమిది": 8, "తొమ్మిది": 9, "పది": 10, "పదకొండు": 11, "పన్నెండు": 12, "పదమూడు": 13,
      "పద్నాలుగు": 14, "పదిహేను": 15, "పదహారు": 16, "పదిహేడు": 17, "పద్దెనిమిది": 18, "పంతొమ్మిది": 19,
    },
    tens: { "ఇరవై": 20, "ముప్పై": 30, "నలభై": 40, "యాభై": 50, "అరవై": 60, "డెబ్బై": 70, "ఎనభై": 80, "తొంభై": 90 },
    compounds: true,
  },
  ta: {
    ones: {
      "பூஜ்ஜியம்": 0, "ஒன்று": 1, "இரண்டு": 2, "மூன்று": 3, "நான்கு": 4, "ஐந்து": 5, "ஆறு": 6,
      "ஏழு": 7, "எட்டு": 8, "ஒன்பது": 9, "பத்து": 10, "பதினொன்று": 11, "பன்னிரண்டு": 12,
      "பதின்மூன்று": 13, "பதினான்கு": 14, "பதினைந்து": 15, "பதினாறு": 16, "பதினேழு": 17,
      "பதினெட்டு": 18, "பத்தொன்பது": 19,
    },
    // Both the standalone form (இருபது, "twenty" on its own) AND the
    // euphonic "combining" form Tamil actually uses right before a ones
    // word (இருபத்து/இருபத்தி — roughly "twenty-of") are listed here,
    // pointing to the same value. Confirmed a real, dangerous bug from
    // only having the standalone form: fed "இருபத்தி நான்கு மாதங்கள்"
    // ("twenty-four months"), wordsToDigits couldn't recognize
    // "இருபத்தி" at all, left it as an ordinary word, converted only
    // "நான்கு" (4) to a digit, and the bare-digit regex downstream then
    // silently matched just that "4" — a loan tenure of 24 months would
    // have been saved as 4, with no error, the same severity of bug as
    // the "two lakh" -> "2" regression documented above, just triggered
    // by a missing combining form instead of a missing normalization
    // pass entirely.
    tens: {
      "இருபது": 20, "இருபத்து": 20, "இருபத்தி": 20,
      "முப்பது": 30, "முப்பத்து": 30, "முப்பத்தி": 30,
      "நாற்பது": 40, "நாற்பத்து": 40, "நாற்பத்தி": 40,
      "ஐம்பது": 50, "ஐம்பத்து": 50, "ஐம்பத்தி": 50,
      "அறுபது": 60, "அறுபத்து": 60, "அறுபத்தி": 60,
      "எழுபது": 70, "எழுபத்து": 70, "எழுபத்தி": 70,
      "எண்பது": 80, "எண்பத்து": 80, "எண்பத்தி": 80,
      "தொண்ணூறு": 90, "தொண்ணூற்று": 90,
    },
    compounds: true,
  },
  kn: {
    ones: {
      "ಸೊನ್ನೆ": 0, "ಒಂದು": 1, "ಎರಡು": 2, "ಇಬ್ಬರು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4, "ಐದು": 5, "ಆರು": 6,
      "ಏಳು": 7, "ಎಂಟು": 8, "ಒಂಬತ್ತು": 9, "ಹತ್ತು": 10, "ಹನ್ನೊಂದು": 11, "ಹನ್ನೆರಡು": 12,
      "ಹದಿಮೂರು": 13, "ಹದಿನಾಲ್ಕು": 14, "ಹದಿನೈದು": 15, "ಹದಿನಾರು": 16, "ಹದಿನೇಳು": 17,
      "ಹದಿನೆಂಟು": 18, "ಹತ್ತೊಂಬತ್ತು": 19,
    },
    tens: { "ಇಪ್ಪತ್ತು": 20, "ಮೂವತ್ತು": 30, "ನಲವತ್ತು": 40, "ಐವತ್ತು": 50, "ಅರವತ್ತು": 60, "ಎಪ್ಪತ್ತು": 70, "ಎಂಬತ್ತು": 80, "ತೊಂಬತ್ತು": 90 },
    compounds: true,
  },
  ml: {
    ones: {
      "പൂജ്യം": 0, "ഒന്ന്": 1, "രണ്ട്": 2, "മൂന്ന്": 3, "നാല്": 4, "അഞ്ച്": 5, "ആറ്": 6,
      "ഏഴ്": 7, "എട്ട്": 8, "ഒൻപത്": 9, "പത്ത്": 10, "പതിനൊന്ന്": 11, "പന്ത്രണ്ട്": 12,
      "പതിമൂന്ന്": 13, "പതിനാല്": 14, "പതിനഞ്ച്": 15, "പതിനാറ്": 16, "പതിനേഴ്": 17,
      "പതിനെട്ട്": 18, "പത്തൊൻപത്": 19,
    },
    tens: { "ഇരുപത്": 20, "മുപ്പത്": 30, "നാൽപത്": 40, "അമ്പത്": 50, "അറുപത്": 60, "എഴുപത്": 70, "എൺപത്": 80, "തൊണ്ണൂറ്": 90 },
    compounds: true,
  },
};

/** Rewrites every spelled-out number word (or, for the four languages that
 * regularly compound them, a "tens ones" pair like "twenty five" /
 * "ఇరవై నాలుగు") in `text` to its digit string, leaving everything else
 * untouched — a normalization pass run BEFORE both the multiplier-word and
 * bare-digit checks below, not a separate late fallback of its own.
 *
 * That ordering matters and was the site of a real bug caught in an actual
 * end-to-end test run (not just unit-tested in isolation): an earlier
 * version of this fix was a last-resort branch that ran *after*
 * parseAmountWithMultipliers and just grabbed the first number word it
 * found, with no idea a multiplier word came after it. Fed "two lakh fifty
 * thousand rupees", it matched "two" and returned 2 — silently saving a
 * requested loan amount of ₹2 for what should have been ₹2,50,000, with no
 * error at all (worse than the pre-fix behavior, which at least failed
 * safely and re-asked). Normalizing "two lakh fifty thousand" to
 * "2 lakh 50 thousand" *first* and only then handing it to the existing
 * digit-based multiplier parser fixes both the original gap and this
 * regression in one pass, since the multiplier parser already handles
 * "<digits> <word>" correctly — it just never saw digits when the borrower
 * spelled the number out. Same reasoning applies per-language below.
 */
function wordsToDigits(text: string, lang: LangCode): string {
  const config = NUMBER_WORDS[lang];
  if (!config) return text;

  // Word-boundary-safe, in-place regex replace on the ORIGINAL text — not a
  // tokenize()-then-rejoin round trip like the previous version of this
  // function used. That mattered: tokenize() splits on any run of
  // non-letter/digit/mark characters, so it treats a comma or a period
  // exactly like a space. Feeding an already-digit answer like "2,50,000."
  // through tokenize+rejoin silently produced three separate tokens
  // "2"/"50"/"000", rejoined with single spaces — the comma-grouping that
  // made it one number was gone, and the bare-digit fallback downstream
  // then only ever saw the first fragment, "2" (confirmed live, both typed
  // and spoken: a ₹2,50,000 loan amount was silently saved as ₹2). Matching
  // and replacing only the actual spelled-out number words in place leaves
  // every digit, comma, period, and space elsewhere in the text completely
  // untouched, so an already-numeric answer just passes through unchanged.
  const byPhrase = new Map<string, number>();
  const phrasePatterns: string[] = [];
  for (const [tensWord, tensValue] of Object.entries(config.tens)) {
    byPhrase.set(tensWord, tensValue);
    phrasePatterns.push(escapeRegExp(tensWord));
    if (config.compounds) {
      for (const [onesWord, onesValue] of Object.entries(config.ones)) {
        if (onesValue < 10) {
          // \s+ (not a literal single space) between the two words — real
          // transcribed/typed text doesn't always have exactly one space,
          // and this still needs to out-compete the bare tens-word
          // alternative below for "twenty five" to become one 25 rather
          // than a stranded 20 + 5.
          byPhrase.set(`${tensWord} ${onesWord}`, tensValue + onesValue);
          phrasePatterns.push(`${escapeRegExp(tensWord)}\\s+${escapeRegExp(onesWord)}`);
        }
      }
    }
  }
  for (const [onesWord, onesValue] of Object.entries(config.ones)) {
    byPhrase.set(onesWord, onesValue);
    phrasePatterns.push(escapeRegExp(onesWord));
  }
  if (phrasePatterns.length === 0) return text;

  // Longest pattern first so a compound match is tried before the shorter
  // bare tens-word alternative sitting right behind it in the alternation.
  phrasePatterns.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(${phrasePatterns.join("|")})(?![\\p{L}\\p{N}\\p{M}])`, "giu");

  return text.replace(pattern, (match) => {
    const key = match.toLowerCase().replace(/\s+/g, " ").trim();
    const value = byPhrase.get(key);
    return value !== undefined ? String(value) : match;
  });
}

/** Sums every "<number> <multiplier-word>" occurrence, e.g. "2 lakh 50 thousand" -> 250000.
 * Returns null if no multiplier word is found (caller falls back to a bare-digit match).
 *
 * Uses one combined, non-overlapping regex scan rather than a separate exec() per word —
 * several languages list both a full word and its own prefix as valid forms (Telugu
 * "లక్షలు"/"లక్ష", Hindi "करोड़"/"करोड"), and matching them independently double-counted
 * the same digits once per matching word. Sorting alternatives longest-first and scanning
 * once means each span of text is consumed by at most one match. */
function parseAmountWithMultipliers(text: string, lang: LangCode): number | null {
  const groups = MULTIPLIER_WORDS[lang] ?? MULTIPLIER_WORDS.en;
  const allGroups = lang === "en" ? groups : [...groups, ...MULTIPLIER_WORDS.en]; // borrowers often mix in English "lakh"/"crore"

  const wordToMult = new Map<string, number>();
  for (const g of allGroups) {
    for (const w of g.words) {
      if (!wordToMult.has(w.toLowerCase())) wordToMult.set(w.toLowerCase(), g.value);
    }
  }
  const words = [...wordToMult.keys()].sort((a, b) => b.length - a.length);
  if (words.length === 0) return null;

  // Trailing boundary check — (?![\p{L}\p{M}]) — is required, not optional:
  // confirmed live, a bare alternation with no boundary let "ലക്ഷ" (a real,
  // deliberately-short dictionary entry — Malayalam's own short form of
  // "lakh") match as a mid-word PREFIX of "ലക്ഷത്തി" ("lakh"'s combining
  // form before a following number), inside "two lakh fifty thousand
  // rupees" stated in Malayalam. That silently computed 2 × 100,000 =
  // 200,000 and stopped — a real ₹2,50,000 loan amount saved as ₹2,00,000,
  // wrong by ₹50,000 with no error at all, because the regex was satisfied
  // by consuming only part of "ലക്ഷത്തി" and never noticed the rest of
  // that word (or the separate, unrecognized "fifty-thousand" that
  // followed) wasn't accounted for. A plain \b can't fix this the normal
  // way — confirmed elsewhere in this file that \b doesn't exist at all
  // relative to non-Latin scripts — so this uses the same \p{L}/\p{M}
  // "what counts as part of a word" definition tokenize() already
  // established, as a lookahead instead of a split.
  const pattern = new RegExp(`([\\d.,]+)\\s*(${words.map(escapeRegExp).join("|")})(?![\\p{L}\\p{M}])`, "giu");
  let total = 0;
  let matchedAny = false;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const num = parseFloat(m[1].replace(/,/g, ""));
    const mult = wordToMult.get(m[2].toLowerCase());
    if (!isNaN(num) && mult) {
      total += num * mult;
      matchedAny = true;
    }
  }
  return matchedAny ? Math.round(total) : null;
}

/** True if `text` contains something that looks like it's trying to
 * reference a lakh/crore/thousand-style multiplier word, even if it's not
 * an exact match for any word in MULTIPLIER_WORDS — a combining/inflected
 * form (Tamil "லட்சத்து" vs the dictionary's "லட்சம்"), or one fused into a
 * larger compound word (Malayalam "അമ്പതിനായിരം" containing "ஆயிரம்" — sorry,
 * containing "ആയിരം" — as a literal trailing substring). Checks a shortened
 * "root" of each known word as a substring probe rather than requiring an
 * exact token match, deliberately looser than parseAmountWithMultipliers.
 *
 * Exists specifically to gate the bare-digit fallback in the number branch
 * below. Confirmed live, twice, in the same end-to-end multi-language test
 * run: "இரண்டு லட்சத்து ஐம்பதாயிரம் ரூபாய்" ("two lakh fifty thousand
 * rupees") — parseAmountWithMultipliers couldn't resolve either
 * "லட்சத்து" (combining form, dictionary only has "லட்சம்") or
 * "ஐம்பதாயிரம்" (a fully fused "fifty-thousand") — and with no guard, the
 * bare-digit regex downstream just grabbed the leading "2" from "இரண்டு" ->
 * 2, silently saving a stated ₹2,50,000 loan amount as ₹2. This is the
 * same severity bug as the earlier documented "two lakh" -> "2" regression,
 * just from a different missing vocabulary form — confirming this is a
 * recurring failure shape (any language's multiplier vocabulary will always
 * have combining/fused forms this file hasn't anticipated), not a one-off
 * to patch by adding one more word. Better to safely fail (re-ask) whenever
 * the text clearly seems to be describing a multiplied amount than to risk
 * silently saving a wildly wrong one — same "honest failure over guessed
 * answer" principle this whole file already follows everywhere else. */
function containsMultiplierHint(text: string, lang: LangCode): boolean {
  const groups = MULTIPLIER_WORDS[lang] ?? [];
  const allGroups = lang === "en" ? groups : [...groups, ...MULTIPLIER_WORDS.en];
  const lower = text.toLowerCase();
  for (const g of allGroups) {
    for (const w of g.words) {
      const word = w.toLowerCase();
      // Try progressively shorter roots (drop 1, then 2, then 3 trailing
      // characters, never below 3 characters left) rather than a single
      // fixed trim — confirmed necessary live: Tamil "லட்சம்" and its real
      // combining form "லட்சத்து" only share a 4-character stem
      // ("லட்ச"), which dropping just the last character of "லட்சம்"
      // doesn't reach (that only strips the trailing combining mark,
      // leaving a 5-character root that still isn't a substring of the
      // combining form). How many characters a script's inflectional
      // ending needs trimmed isn't the same word to word, so try a few
      // instead of tuning one fixed amount per word.
      for (let trim = 0; trim <= 3 && word.length - trim >= 3; trim++) {
        const root = trim === 0 ? word : word.slice(0, -trim);
        if (lower.includes(root)) return true;
      }
    }
  }
  return false;
}

/** Extracts a value for the given form field from a free-text utterance, in the borrower's
 * selected language. Numbers and choice options are matched against that language's words,
 * not just English — see MULTIPLIER_WORDS and the localized-label check below. */
export function extractFieldValue(
  fieldKey: string,
  raw: string,
  lang: LangCode = "en",
  segment?: SegmentCode
): ExtractionResult {
  const text = normalizeDigits(raw.trim());
  const field = findFieldDef(fieldKey, segment);
  if (!text) return { ok: false, value: null, displayValue: "" };

  if (field?.type === "number") {
    // Normalize spelled-out number words to digits FIRST, in the borrower's
    // own language (see wordsToDigits's doc comment for why this has to
    // happen before the multiplier check, not after it) — "two lakh fifty
    // thousand" -> "2 lakh 50 thousand" -> the multiplier parser below
    // handles it exactly like it already handles a literal "2 lakh 50
    // thousand".
    const normalized = wordsToDigits(text, lang);
    const multiplierValue = parseAmountWithMultipliers(normalized, lang);
    if (multiplierValue !== null) {
      return { ok: true, value: multiplierValue, displayValue: multiplierValue.toLocaleString("en-IN") };
    }
    // Guard before the bare-digit fallback — see containsMultiplierHint's
    // own doc comment for the real, confirmed bug this prevents: text that
    // clearly seems to be stating a multiplied amount (contains a lakh/
    // crore/thousand word or a close variant) but which the multiplier
    // parser above couldn't fully resolve must NOT fall through to grabbing
    // some unrelated leading digit as if it were the whole answer.
    if (containsMultiplierHint(text, lang)) {
      return { ok: false, value: null, displayValue: text };
    }
    const numMatch = normalized.replace(/,/g, "").match(/\d+(\.\d+)?/);
    if (numMatch) {
      const value = Math.round(parseFloat(numMatch[0]));
      return { ok: true, value, displayValue: value.toLocaleString("en-IN") };
    }
    return { ok: false, value: null, displayValue: text };
  }

  if (field?.type === "choice" && field.choices) {
    // Whole-word match via tokenize/containsPhrase (see their doc comments
    // above), not plain .includes() — a choice whose value is a substring of
    // another (e.g. "male" inside "female") would otherwise always match the
    // shorter one first. The previous \b-regex version of this exact check
    // silently never matched ANY non-English label — confirmed the same
    // Unicode \b gap here as isAffirmative/isNegative had, affecting every
    // localized gender/marital-status/ownership/ID-type/product-type choice
    // in Hindi/Telugu/Tamil/Kannada/Malayalam.
    const textTokens = tokenize(text);
    const matches = (candidate: string) => Boolean(candidate) && containsPhrase(textTokens, candidate);
    const found = field.choices.find((c) => {
      const localizedLabel = t(lang, c.labelKey).toLowerCase();
      return (
        matches(c.value.replace("_", " ")) ||
        matches(c.labelKey.toLowerCase()) ||
        matches(localizedLabel) ||
        (c.aliases ?? []).some((alias) => matches(alias.toLowerCase()))
      );
    });
    if (found) return { ok: true, value: found.value, displayValue: t(lang, found.labelKey) };
    return { ok: false, value: null, displayValue: text };
  }

  // The "email" field specifically: real end-to-end test confirmed a
  // borrower dictating their address aloud ("ramesh dot kumar at gmail dot
  // com") gets saved completely verbatim — "ramesh dot kumar at gmail dot
  // com" is not a usable email address, and this field is exactly the one
  // place that unusable value would silently break something real
  // downstream (notifications, dossier contact info). Reconstructing the
  // spoken punctuation is specific to this one field, not a general
  // text-field behavior — "dot"/"at"/"dash"/"underscore" are only safe to
  // rewrite when the field is unambiguously an email address.
  if (fieldKey === "email" && lang === "en") {
    const reconstructed = text
      .toLowerCase()
      .replace(/\s*\bat\b\s*/g, "@")
      .replace(/\s*\bdot\b\s*/g, ".")
      .replace(/\s*\b(dash|hyphen)\b\s*/g, "-")
      .replace(/\s*\bunderscore\b\s*/g, "_")
      .replace(/\s+/g, "");
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reconstructed)) {
      return { ok: true, value: reconstructed, displayValue: reconstructed };
    }
    // Didn't come out looking like an email after reconstruction (borrower
    // may have just typed it correctly already, or said something this
    // simple word-swap can't fix) — fall through to the generic text
    // handling below rather than force a bad value.
  }

  // The "idNumber" field specifically: reported live, mic input for an
  // Aadhaar number came through with a trailing period — Web Speech API
  // commonly appends terminal punctuation at the end of a dictated
  // utterance, same class of artifact as the "dot"/"at" spoken-punctuation
  // problem email has, just unwanted here instead of needed. Not just
  // cosmetic: idProofCheck.ts's own OCR cross-check (checkIdNumberMatch)
  // normalizes by stripping whitespace only, not stray punctuation, so a
  // saved "123456789012." would never match the OCR'd 12-digit Aadhaar
  // number and would flag as a mismatch every time — a false positive
  // caused by this bug, not by a genuine data problem. No legitimate
  // Aadhaar/PAN/Voter ID/driving-licence number ever contains a period or
  // comma, so stripping them unconditionally (not just trailing — dictation
  // punctuation isn't always exactly at the end) is always safe here.
  if (fieldKey === "idNumber") {
    const cleaned = text.replace(/[.,]/g, "").trim();
    if (cleaned.length >= 2) {
      return { ok: true, value: cleaned, displayValue: cleaned };
    }
  }

  // text / textarea: accept as-is if it looks like a real answer (not just noise) —
  // stored verbatim in whatever language/script the borrower used, never translated.
  if (text.length < 2) return { ok: false, value: null, displayValue: text };

  // Strip a generic conversational lead-in ("My name is X" -> "X") for
  // plain "text" fields only — NOT textarea, where the full sentence is
  // usually the intended answer (loanPurpose, existingObligations read
  // naturally as sentences; stripping "I run" from "I run a small business"
  // would leave a fragment, not a cleaner answer). Confirmed live: a
  // borrower answering "fullName" with "My name is Ramesh Kumar" got that
  // entire sentence saved as their name. English-only for now — confirmed
  // in the same multi-language end-to-end test run that this is a real,
  // still-open gap in all five other launch languages too ("मेरा नाम रमेश
  // कुमार है" etc. all saved verbatim), unlike wordsToDigits above, which
  // that same test run confirmed now covers all six. Anchored to the START
  // of the text only, so it can't ever eat into the middle of a genuine
  // answer that happens to contain one of these phrases.
  if (field?.type === "text" && lang === "en") {
    const stripped = text.replace(/^(my name is|i am|i'm|this is|it is|it's|call me|you can call me)\s+/i, "").trim();
    if (stripped.length >= 2) {
      return { ok: true, value: stripped, displayValue: stripped };
    }
  }

  return { ok: true, value: text, displayValue: text };
}

interface FaqEntry {
  keywords: string[];
  answerKey: string;
  answer: Record<LangCode, string>;
}

// Pre-approved product content only (FR-CHB-03) — no free-form financial advice.
const FAQ: FaqEntry[] = [
  {
    keywords: ["interest", "rate", "fee", "charges"],
    answerKey: "faq_interest",
    answer: {
      en: "Interest rates depend on the loan product and your profile — your assigned underwriter will confirm the exact rate after reviewing your application. There's no fee to apply.",
      hi: "ब्याज दरें ऋण उत्पाद और आपकी प्रोफ़ाइल पर निर्भर करती हैं — आपका नियुक्त अंडरराइटर आपके आवेदन की समीक्षा के बाद सटीक दर की पुष्टि करेगा। आवेदन करने के लिए कोई शुल्क नहीं है।",
      te: "వడ్డీ రేట్లు రుణ ఉత్పత్తి మరియు మీ ప్రొఫైల్‌పై ఆధారపడి ఉంటాయి — మీ దరఖాస్తును సమీక్షించిన తర్వాత మీకు కేటాయించిన అండర్‌రైటర్ ఖచ్చితమైన రేటును నిర్ధారిస్తారు. దరఖాస్తు చేయడానికి ఎటువంటి రుసుము లేదు.",
      ta: "வட்டி விகிதங்கள் கடன் தயாரிப்பு மற்றும் உங்கள் சுயவிவரத்தைப் பொறுத்தது — உங்கள் விண்ணப்பத்தை மதிப்பாய்வு செய்த பிறகு உங்களுக்கு ஒதுக்கப்பட்ட அண்டர்ரைட்டர் சரியான விகிதத்தை உறுதிப்படுத்துவார். விண்ணப்பிக்க கட்டணம் இல்லை.",
      kn: "ಬಡ್ಡಿ ದರಗಳು ಸಾಲ ಉತ್ಪನ್ನ ಮತ್ತು ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ಅನ್ನು ಅವಲಂಬಿಸಿರುತ್ತದೆ — ನಿಮ್ಮ ಅರ್ಜಿಯನ್ನು ಪರಿಶೀಲಿಸಿದ ನಂತರ ನಿಮಗೆ ನಿಯೋಜಿಸಲಾದ ಅಂಡರ್‌ರೈಟರ್ ನಿಖರವಾದ ದರವನ್ನು ದೃಢಪಡಿಸುತ್ತಾರೆ. ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಯಾವುದೇ ಶುಲ್ಕವಿಲ್ಲ.",
      ml: "പലിശ നിരക്കുകൾ വായ്പാ ഉൽപ്പന്നത്തെയും നിങ്ങളുടെ പ്രൊഫൈലിനെയും ആശ്രയിച്ചിരിക്കുന്നു — നിങ്ങളുടെ അപേക്ഷ അവലോകനം ചെയ്ത ശേഷം നിങ്ങൾക്ക് നിയോഗിച്ച അണ്ടർറൈറ്റർ കൃത്യമായ നിരക്ക് സ്ഥിരീകരിക്കും. അപേക്ഷിക്കാൻ ഫീസ് ഇല്ല.",
    },
  },
  {
    keywords: ["document", "papers", "proof", "id"],
    answerKey: "faq_documents",
    answer: {
      en: "You'll need an ID proof (Aadhaar, PAN, Voter ID, or Driving Licence), an address proof, and photos or a short video of your workshop, farm, or business.",
      hi: "आपको एक पहचान प्रमाण (आधार, पैन, वोटर आईडी, या ड्राइविंग लाइसेंस), एक पता प्रमाण, और आपकी वर्कशॉप, खेत, या व्यवसाय की फ़ोटो या एक छोटा वीडियो चाहिए होगा।",
      te: "మీకు గుర్తింపు రుజువు (ఆధార్, పాన్, ఓటర్ ఐడి, లేదా డ్రైవింగ్ లైసెన్స్), చిరునామా రుజువు, మరియు మీ వర్క్‌షాప్, పొలం, లేదా వ్యాపారం యొక్క ఫోటోలు లేదా చిన్న వీడియో అవసరం.",
      ta: "உங்களுக்கு அடையாள சான்று (ஆதார், பான், வாக்காளர் அடையாள அட்டை, அல்லது ஓட்டுநர் உரிமம்), முகவரி சான்று, மற்றும் உங்கள் பட்டறை, பண்ணை, அல்லது வணிகத்தின் புகைப்படங்கள் அல்லது ஒரு குறுகிய வீடியோ தேவை.",
      kn: "ನಿಮಗೆ ಗುರುತಿನ ಪುರಾವೆ (ಆಧಾರ್, ಪ್ಯಾನ್, ಮತದಾರ ಗುರುತಿನ ಚೀಟಿ, ಅಥವಾ ಚಾಲನಾ ಪರವಾನಗಿ), ವಿಳಾಸ ಪುರಾವೆ, ಮತ್ತು ನಿಮ್ಮ ವರ್ಕ್‌ಶಾಪ್, ಜಮೀನು, ಅಥವಾ ವ್ಯಾಪಾರದ ಫೋಟೋಗಳು ಅಥವಾ ಸಣ್ಣ ವೀಡಿಯೊ ಅಗತ್ಯವಿದೆ.",
      ml: "നിങ്ങൾക്ക് ഒരു തിരിച്ചറിയൽ രേഖ (ആധാർ, പാൻ, വോട്ടർ ഐഡി, അല്ലെങ്കിൽ ഡ്രൈവിംഗ് ലൈസൻസ്), ഒരു വിലാസ രേഖ, കൂടാതെ നിങ്ങളുടെ വർക്ക്ഷോപ്പ്, കൃഷിയിടം, അല്ലെങ്കിൽ ബിസിനസ്സിന്റെ ഫോട്ടോകളോ ഒരു ചെറിയ വീഡിയോയോ ആവശ്യമാണ്.",
    },
  },
  {
    keywords: ["time", "long", "how many days", "when"],
    answerKey: "faq_timeline",
    answer: {
      en: "Once you submit, we usually create your lead within a few minutes. An underwriter typically reaches out within 24 hours to schedule your video verification call.",
      hi: "आपके जमा करने के बाद, हम आमतौर पर कुछ ही मिनटों में आपका लीड बनाते हैं। एक अंडरराइटर आमतौर पर आपकी वीडियो सत्यापन कॉल शेड्यूल करने के लिए 24 घंटों के भीतर संपर्क करता है।",
      te: "మీరు సమర్పించిన తర్వాత, మేము సాధారణంగా కొన్ని నిమిషాల్లో మీ లీడ్‌ను సృష్టిస్తాము. వీడియో ధృవీకరణ కాల్‌ను షెడ్యూల్ చేయడానికి అండర్‌రైటర్ సాధారణంగా 24 గంటల్లో సంప్రదిస్తారు.",
      ta: "நீங்கள் சமர்ப்பித்தவுடன், நாங்கள் பொதுவாக சில நிமிடங்களில் உங்கள் லீட்டை உருவாக்குகிறோம். உங்கள் வீடியோ சரிபார்ப்பு அழைப்பை திட்டமிட ஒரு அண்டர்ரைட்டர் பொதுவாக 24 மணி நேரத்திற்குள் தொடர்பு கொள்வார்.",
      kn: "ನೀವು ಸಲ್ಲಿಸಿದ ನಂತರ, ನಾವು ಸಾಮಾನ್ಯವಾಗಿ ಕೆಲವು ನಿಮಿಷಗಳಲ್ಲಿ ನಿಮ್ಮ ಲೀಡ್ ಅನ್ನು ರಚಿಸುತ್ತೇವೆ. ನಿಮ್ಮ ವೀಡಿಯೊ ಪರಿಶೀಲನಾ ಕರೆಯನ್ನು ನಿಗದಿಪಡಿಸಲು ಅಂಡರ್‌ರೈಟರ್ ಸಾಮಾನ್ಯವಾಗಿ 24 ಗಂಟೆಗಳಲ್ಲಿ ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
      ml: "നിങ്ങൾ സമർപ്പിച്ചുകഴിഞ്ഞാൽ, ഞങ്ങൾ സാധാരണയായി കുറച്ച് മിനിറ്റുകൾക്കുള്ളിൽ നിങ്ങളുടെ ലീഡ് സൃഷ്ടിക്കുന്നു. നിങ്ങളുടെ വീഡിയോ പരിശോധന കോൾ ഷെഡ്യൂൾ ചെയ്യാൻ ഒരു അണ്ടർറൈറ്റർ സാധാരണയായി 24 മണിക്കൂറിനുള്ളിൽ ബന്ധപ്പെടും.",
    },
  },
  {
    keywords: ["eligib", "qualify", "who can"],
    answerKey: "faq_eligibility",
    answer: {
      en: "Farmers, vocational-training students, and small business/workshop owners can apply. There's no fixed collateral requirement — your VideoPD verification is a key part of how we assess your application.",
      hi: "किसान, व्यावसायिक-प्रशिक्षण छात्र, और छोटे व्यवसाय/वर्कशॉप मालिक आवेदन कर सकते हैं। कोई निश्चित संपार्श्विक आवश्यकता नहीं है — आपका VideoPD सत्यापन आपके आवेदन का आकलन करने का एक महत्वपूर्ण हिस्सा है।",
      te: "రైతులు, వృత్తి-శిక్షణ విద్యార్థులు, మరియు చిన్న వ్యాపార/వర్క్‌షాప్ యజమానులు దరఖాస్తు చేసుకోవచ్చు. స్థిర తనఖా అవసరం లేదు — మీ దరఖాస్తును అంచనా వేయడంలో మీ VideoPD ధృవీకరణ కీలక భాగం.",
      ta: "விவசாயிகள், தொழில் பயிற்சி மாணவர்கள், மற்றும் சிறு வணிக/பட்டறை உரிமையாளர்கள் விண்ணப்பிக்கலாம். நிலையான பிணையம் தேவையில்லை — உங்கள் VideoPD சரிபார்ப்பு உங்கள் விண்ணப்பத்தை மதிப்பிடுவதில் ஒரு முக்கிய பகுதியாகும்.",
      kn: "ರೈತರು, ವೃತ್ತಿಪರ-ತರಬೇತಿ ವಿದ್ಯಾರ್ಥಿಗಳು, ಮತ್ತು ಸಣ್ಣ ವ್ಯಾಪಾರ/ವರ್ಕ್‌ಶಾಪ್ ಮಾಲೀಕರು ಅರ್ಜಿ ಸಲ್ಲಿಸಬಹುದು. ಸ್ಥಿರ ಅಡಮಾನ ಅಗತ್ಯವಿಲ್ಲ — ನಿಮ್ಮ ಅರ್ಜಿಯನ್ನು ನಿರ್ಣಯಿಸುವಲ್ಲಿ ನಿಮ್ಮ VideoPD ಪರಿಶೀಲನೆ ಪ್ರಮುಖ ಭಾಗವಾಗಿದೆ.",
      ml: "കർഷകർ, തൊഴിൽ-പരിശീലന വിദ്യാർത്ഥികൾ, ചെറുകിട ബിസിനസ്സ്/വർക്ക്ഷോപ്പ് ഉടമകൾ എന്നിവർക്ക് അപേക്ഷിക്കാം. സ്ഥിര ഈട് ആവശ്യമില്ല — നിങ്ങളുടെ അപേക്ഷ വിലയിരുത്തുന്നതിലെ ഒരു പ്രധാന ഭാഗമാണ് നിങ്ങളുടെ VideoPD പരിശോധന.",
    },
  },
];

export function matchFaq(text: string, lang: LangCode): string | null {
  const lower = text.toLowerCase();
  for (const entry of FAQ) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return entry.answer[lang] ?? entry.answer.en;
    }
  }
  return null;
}

export function fieldLabel(fieldKey: string, lang: LangCode, segment?: SegmentCode): string {
  const field = findFieldDef(fieldKey, segment);
  return field ? t(lang, field.labelKey) : fieldKey;
}

export function fieldPrompt(fieldKey: string, lang: LangCode, segment?: SegmentCode): string {
  const field = findFieldDef(fieldKey, segment);
  if (!field) return "";
  return `${t(lang, field.labelKey)}?`;
}
