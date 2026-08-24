// One-time migration: seeds the 9 questions that used to live hardcoded in
// src/lib/videoPdQuestions.ts + i18n.ts into VideoPdQuestionConfig, marked
// APPROVED (they were already live) so the borrower-facing flow keeps
// working unchanged after the switch to DB-backed, admin-managed questions.
// Safe to re-run — skips any (segment, key) pair that already exists.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const QUESTIONS = [
  {
    segment: "FARMER", key: "cropCycle", orderIndex: 0,
    promptEn: "Tell us about your crop cycle — what do you grow, and in which season?",
    promptHi: "अपने फसल चक्र के बारे में बताएं — आप क्या उगाते हैं, और किस मौसम में?",
    promptTe: "మీ పంట చక్రం గురించి చెప్పండి — మీరు ఏమి పండిస్తారు, మరియు ఏ సీజన్‌లో?",
    promptTa: "உங்கள் பயிர் சுழற்சியைப் பற்றி சொல்லுங்கள் — நீங்கள் என்ன பயிரிடுகிறீர்கள், எந்த பருவத்தில்?",
    promptKn: "ನಿಮ್ಮ ಬೆಳೆ ಚಕ್ರದ ಬಗ್ಗೆ ಹೇಳಿ — ನೀವು ಏನು ಬೆಳೆಯುತ್ತೀರಿ, ಮತ್ತು ಯಾವ ಋತುವಿನಲ್ಲಿ?",
    promptMl: "നിങ്ങളുടെ വിള ചക്രത്തെക്കുറിച്ച് പറയൂ — നിങ്ങൾ എന്താണ് കൃഷി ചെയ്യുന്നത്, ഏത് സീസണിൽ?",
  },
  {
    segment: "FARMER", key: "equipmentUse", orderIndex: 1,
    promptEn: "How do you use your farm equipment day-to-day?",
    promptHi: "आप अपने कृषि उपकरणों का रोज़ाना उपयोग कैसे करते हैं?",
    promptTe: "మీరు మీ వ్యవసాయ పరికరాలను రోజువారీగా ఎలా ఉపయోగిస్తారు?",
    promptTa: "உங்கள் விவசாய உபகரணங்களை தினமும் எப்படி பயன்படுத்துகிறீர்கள்?",
    promptKn: "ನಿಮ್ಮ ಕೃಷಿ ಉಪಕರಣಗಳನ್ನು ನೀವು ದಿನನಿತ್ಯ ಹೇಗೆ ಬಳಸುತ್ತೀರಿ?",
    promptMl: "നിങ്ങളുടെ കാർഷിക ഉപകരണങ്ങൾ നിങ്ങൾ ദിവസേന എങ്ങനെ ഉപയോഗിക്കുന്നു?",
  },
  {
    segment: "FARMER", key: "market", orderIndex: 2,
    promptEn: "Where do you usually sell your produce, and how do you decide when to sell?",
    promptHi: "आप आमतौर पर अपनी उपज कहाँ बेचते हैं, और बेचने का समय कैसे तय करते हैं?",
    promptTe: "మీరు సాధారణంగా మీ దిగుబడిని ఎక్కడ అమ్ముతారు, మరియు అమ్మే సమయాన్ని ఎలా నిర్ణయిస్తారు?",
    promptTa: "நீங்கள் பொதுவாக உங்கள் விளைபொருளை எங்கே விற்கிறீர்கள், விற்கும் நேரத்தை எப்படி முடிவு செய்கிறீர்கள்?",
    promptKn: "ನೀವು ಸಾಮಾನ್ಯವಾಗಿ ನಿಮ್ಮ ಉತ್ಪನ್ನವನ್ನು ಎಲ್ಲಿ ಮಾರಾಟ ಮಾಡುತ್ತೀರಿ, ಮತ್ತು ಮಾರಾಟ ಮಾಡುವ ಸಮಯವನ್ನು ಹೇಗೆ ನಿರ್ಧರಿಸುತ್ತೀರಿ?",
    promptMl: "നിങ്ങൾ സാധാരണയായി നിങ്ങളുടെ ഉൽപ്പന്നം എവിടെയാണ് വിൽക്കുന്നത്, വിൽക്കേണ്ട സമയം എങ്ങനെ തീരുമാനിക്കുന്നു?",
  },
  {
    segment: "VOCATIONAL_STUDENT", key: "courseInterest", orderIndex: 0,
    promptEn: "Why did you choose this course, and what do you hope to do after completing it?",
    promptHi: "आपने यह कोर्स क्यों चुना, और इसे पूरा करने के बाद आप क्या करना चाहते हैं?",
    promptTe: "మీరు ఈ కోర్సును ఎందుకు ఎంచుకున్నారు, మరియు దీన్ని పూర్తి చేసిన తర్వాత మీరు ఏమి చేయాలనుకుంటున్నారు?",
    promptTa: "இந்த பாடத்தை ஏன் தேர்ந்தெடுத்தீர்கள், முடித்த பிறகு என்ன செய்ய விரும்புகிறீர்கள்?",
    promptKn: "ನೀವು ಈ ಕೋರ್ಸ್ ಅನ್ನು ಏಕೆ ಆರಿಸಿಕೊಂಡಿರಿ, ಮತ್ತು ಇದನ್ನು ಪೂರ್ಣಗೊಳಿಸಿದ ನಂತರ ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?",
    promptMl: "നിങ്ങൾ ഈ കോഴ്‌സ് തിരഞ്ഞെടുത്തത് എന്തുകൊണ്ട്, ഇത് പൂർത്തിയാക്കിയ ശേഷം നിങ്ങൾ എന്ത് ചെയ്യാൻ ആഗ്രഹിക്കുന്നു?",
  },
  {
    segment: "VOCATIONAL_STUDENT", key: "institute", orderIndex: 1,
    promptEn: "Tell us about your training institute and how classes are conducted.",
    promptHi: "अपने प्रशिक्षण संस्थान के बारे में बताएं और कक्षाएं कैसे संचालित होती हैं।",
    promptTe: "మీ శిక్షణ సంస్థ గురించి మరియు తరగతులు ఎలా నిర్వహించబడతాయో చెప్పండి.",
    promptTa: "உங்கள் பயிற்சி நிறுவனத்தைப் பற்றியும் வகுப்புகள் எப்படி நடத்தப்படுகின்றன என்பதையும் சொல்லுங்கள்.",
    promptKn: "ನಿಮ್ಮ ತರಬೇತಿ ಸಂಸ್ಥೆಯ ಬಗ್ಗೆ ಮತ್ತು ತರಗತಿಗಳು ಹೇಗೆ ನಡೆಸಲ್ಪಡುತ್ತವೆ ಎಂಬುದನ್ನು ಹೇಳಿ.",
    promptMl: "നിങ്ങളുടെ പരിശീലന സ്ഥാപനത്തെക്കുറിച്ചും ക്ലാസുകൾ എങ്ങനെ നടത്തുന്നു എന്നതിനെക്കുറിച്ചും പറയൂ.",
  },
  {
    segment: "VOCATIONAL_STUDENT", key: "skill", orderIndex: 2,
    promptEn: "What skills have you learned so far in this course?",
    promptHi: "अब तक इस कोर्स में आपने कौन से कौशल सीखे हैं?",
    promptTe: "ఇప్పటివరకు ఈ కోర్సులో మీరు ఏ నైపుణ్యాలు నేర్చుకున్నారు?",
    promptTa: "இதுவரை இந்த பாடத்தில் நீங்கள் என்ன திறன்களைக் கற்றுக்கொண்டீர்கள்?",
    promptKn: "ಇಲ್ಲಿಯವರೆಗೆ ಈ ಕೋರ್ಸ್‌ನಲ್ಲಿ ನೀವು ಯಾವ ಕೌಶಲ್ಯಗಳನ್ನು ಕಲಿತಿದ್ದೀರಿ?",
    promptMl: "ഇതുവരെ ഈ കോഴ്‌സിൽ നിങ്ങൾ ഏതൊക്കെ കഴിവുകൾ പഠിച്ചു?",
  },
  {
    segment: "BUSINESS_OWNER", key: "operations", orderIndex: 0,
    promptEn: "Tell us about your day-to-day business operations.",
    promptHi: "अपने रोज़मर्रा के व्यावसायिक कार्यों के बारे में बताएं।",
    promptTe: "మీ రోజువారీ వ్యాపార కార్యకలాపాల గురించి చెప్పండి.",
    promptTa: "உங்கள் அன்றாட வணிக செயல்பாடுகளைப் பற்றி சொல்லுங்கள்.",
    promptKn: "ನಿಮ್ಮ ದೈನಂದಿನ ವ್ಯಾಪಾರ ಕಾರ್ಯಾಚರಣೆಗಳ ಬಗ್ಗೆ ಹೇಳಿ.",
    promptMl: "നിങ്ങളുടെ ദൈനംദിന ബിസിനസ്സ് പ്രവർത്തനങ്ങളെക്കുറിച്ച് പറയൂ.",
  },
  {
    segment: "BUSINESS_OWNER", key: "supplierCustomer", orderIndex: 1,
    promptEn: "Who are your main suppliers and customers?",
    promptHi: "आपके मुख्य आपूर्तिकर्ता और ग्राहक कौन हैं?",
    promptTe: "మీ ప్రధాన సరఫరాదారులు మరియు కస్టమర్లు ఎవరు?",
    promptTa: "உங்கள் முக்கிய சப்ளையர்கள் மற்றும் வாடிக்கையாளர்கள் யார்?",
    promptKn: "ನಿಮ್ಮ ಪ್ರಮುಖ ಪೂರೈಕೆದಾರರು ಮತ್ತು ಗ್ರಾಹಕರು ಯಾರು?",
    promptMl: "നിങ്ങളുടെ പ്രധാന വിതരണക്കാരും ഉപഭോക്താക്കളും ആരാണ്?",
  },
  {
    segment: "BUSINESS_OWNER", key: "growthPlan", orderIndex: 2,
    promptEn: "What would this loan help you do for your business?",
    promptHi: "यह ऋण आपके व्यवसाय के लिए क्या करने में मदद करेगा?",
    promptTe: "ఈ రుణం మీ వ్యాపారం కోసం ఏమి చేయడంలో సహాయపడుతుంది?",
    promptTa: "இந்த கடன் உங்கள் வணிகத்திற்கு என்ன செய்ய உதவும்?",
    promptKn: "ಈ ಸಾಲ ನಿಮ್ಮ ವ್ಯಾಪಾರಕ್ಕೆ ಏನು ಮಾಡಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ?",
    promptMl: "ഈ വായ്പ നിങ്ങളുടെ ബിസിനസ്സിന് എന്ത് ചെയ്യാൻ സഹായിക്കും?",
  },
];

async function main() {
  let created = 0, skipped = 0;
  for (const q of QUESTIONS) {
    const existing = await db.videoPdQuestionConfig.findUnique({
      where: { segment_key: { segment: q.segment, key: q.key } },
    });
    if (existing) { skipped++; continue; }
    await db.videoPdQuestionConfig.create({
      data: { ...q, status: "APPROVED", createdBy: "System (migrated)", approvedBy: "System (migrated)", approvedAt: new Date() },
    });
    created++;
  }
  console.log(`Seeded ${created} question(s), skipped ${skipped} already-existing.`);
}

main().finally(() => db.$disconnect());
