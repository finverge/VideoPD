import { db } from "../src/lib/db";
import fs from "fs";
import path from "path";

async function main() {
  const borrower = await db.borrower.create({
    data: { mobile: `9${Date.now().toString().slice(-9)}`, mobileVerified: true, name: "Ramesh Kumar", segment: "BUSINESS_OWNER", language: "en" },
  });
  const application = await db.loanApplication.create({
    data: {
      borrowerId: borrower.id, segment: "BUSINESS_OWNER", status: "SUBMITTED", fullName: "Ramesh Kumar",
      idNumber: "AXXXX1234X", requestedAmount: 150000, monthlyIncome: 25000, tenureMonths: 18,
      currentAddress: "12 MG Road, Nashik", productType: "Business Expansion",
    },
  });

  const dir = path.join(process.cwd(), "uploads", application.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const type of ["ID_PROOF", "ADDRESS_PROOF", "SELFIE"] as const) {
    const p = path.join(dir, `${type}.jpg`);
    fs.writeFileSync(p, Buffer.from("x".repeat(20_000)));
    await db.uploadedEvidence.create({
      data: { applicationId: application.id, type, fileName: `${type}.jpg`, filePath: path.relative(process.cwd(), p), mimeType: "image/jpeg", sizeBytes: 20_000, qualityStatus: "PASSED" },
    });
  }

  const summaryJson = JSON.stringify({
    borrowerProfile: { name: "Ramesh Kumar", segment: "BUSINESS_OWNER", language: "en", mobile: borrower.mobile },
    loanAsk: { productType: "Business Expansion", amount: 150000, tenureMonths: 18, purpose: "Buy new equipment" },
    documentChecklist: [], riskFlags: [], completenessScore: 85, generatedAt: new Date().toISOString(),
  });
  const lead = await db.lead.create({
    data: { applicationId: application.id, status: "NEW", riskFlagCount: 0, riskSeverity: "none", summary: { create: { summaryJson } } },
  });
  const token = `demo-${Date.now()}`;
  await db.videoPdSession.create({ data: { leadId: lead.id, token, status: "NOT_STARTED" } });

  console.log(JSON.stringify({ borrowerUrl: `http://localhost:3000/videopd/${token}`, underwriterUrl: `http://localhost:3000/staff/case/${lead.id}`, queueUrl: "http://localhost:3000/staff/queue" }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
