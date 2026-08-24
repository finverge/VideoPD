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
// entirely and works for any of the six launch languages, all of which are
// space-separated scripts.
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
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
    { words: ["లక్షలు", "లక్ష"], value: 100000 },
    { words: ["వేలు", "వేల"], value: 1000 },
  ],
  ta: [
    { words: ["கோடி"], value: 10000000 },
    { words: ["இலட்சம்", "லட்சம்"], value: 100000 },
    { words: ["ஆயிரம்"], value: 1000 },
  ],
  kn: [
    { words: ["ಕೋಟಿ"], value: 10000000 },
    { words: ["ಲಕ್ಷ"], value: 100000 },
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

  const pattern = new RegExp(`([\\d.,]+)\\s*(${words.map(escapeRegExp).join("|")})`, "gi");
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
    const multiplierValue = parseAmountWithMultipliers(text, lang);
    if (multiplierValue !== null) {
      return { ok: true, value: multiplierValue, displayValue: multiplierValue.toLocaleString("en-IN") };
    }
    const numMatch = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
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

  // text / textarea: accept as-is if it looks like a real answer (not just noise) —
  // stored verbatim in whatever language/script the borrower used, never translated.
  if (text.length < 2) return { ok: false, value: null, displayValue: text };
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
