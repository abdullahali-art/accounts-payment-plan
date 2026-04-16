import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type DepositPayload = {
  amount: number;
  due: string;
  collected_by: "us" | "university";
};

export type InstallmentPayload = {
  id?: string;
  installmentName: string;
  installmentDate: string;
  feeType: string;
  feeAmount: number;
  discount: number;
  discountPercentage?: number;
  netFee: number;
  collected_by?: "us" | "university";
  fees?: Array<{
    feeType: string;
    feeAmount: number;
    discountPercentage?: number;
  }>;
};

export type PaymentPlanBody = {
  opp_id: string;
  contact_id: string;
  // Section A — auto-filled from GHL
  xero_customer_number?: string;
  program_offer_id?: string;
  xero_tracking_code?: string;
  // Section B — financials
  commission_pct?: number;
  // Section C — deposit
  deposit?: DepositPayload | null;
  // Section D — installments
  installments: InstallmentPayload[];
};

export type PaymentPlanPdfContext = {
  studentName?: string;
  studentEmail?: string;
  application?: string;
  generatedDate?: string;
};

const currency = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatReadableDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function createPlanSummaryString(installments: InstallmentPayload[]): string {
  return installments
    .map(
      (item) =>
        `${item.installmentName}: $${currency.format(item.netFee)} on ${formatReadableDate(item.installmentDate)}`
    )
    .join(" | ");
}

function aggregateFeeRows(installments: InstallmentPayload[]) {
  const map = new Map<string, { terms: number; total: number }>();
  for (const item of installments) {
    const feeTypes = item.fees?.length ? item.fees.map((f) => f.feeType) : [item.feeType];
    for (const feeType of feeTypes) {
      const current = map.get(feeType) || { terms: 0, total: 0 };
      current.terms += 1;
      current.total += item.netFee;
      map.set(feeType, current);
    }
  }
  return Array.from(map.entries()).map(([feeType, val]) => [
    feeType,
    `$${currency.format(val.total / Math.max(val.terms, 1))}`,
    String(val.terms),
    `$${currency.format(val.total)}`,
    "Payable"
  ]);
}

function collectedByLabel(value: "us" | "university" | undefined): string {
  return value === "university" ? "University" : "The Migration";
}

export function generatePdfBuffer(
  payload: PaymentPlanBody,
  context?: PaymentPlanPdfContext
): Buffer {
  const doc = new jsPDF();
  const generatedDate =
    context?.generatedDate ||
    new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

  // Header bar
  doc.setFillColor(5, 55, 97);
  doc.rect(0, 0, 210, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text("Aussie Migration and Education", 14, 13);
  doc.setFontSize(10);
  doc.text("ABN / Office 2, 16 Kendall Street, Harris Park NSW 2150", 14, 22);
  doc.text("support@themigration.com.au  |  +61 489 278 100", 14, 29);

  // Title
  doc.setTextColor(10, 38, 66);
  doc.setFontSize(16);
  doc.text("Payment Plan", 14, 48);
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(`Generated: ${generatedDate}`, 162, 48);

  // Student info block
  doc.setFillColor(240, 243, 247);
  doc.roundedRect(14, 54, 182, 30, 2, 2, "F");
  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  doc.text("Student Name", 17, 63);
  doc.text("Student Email", 109, 63);
  doc.text("Application / Program Offer", 17, 76);

  doc.setTextColor(35, 35, 35);
  doc.setFontSize(10);
  doc.text(context?.studentName || payload.contact_id, 17, 69);
  doc.text(context?.studentEmail || "-", 109, 69);
  doc.text(context?.application || "-", 17, 82);

  // Fee breakdown
  doc.setTextColor(10, 38, 66);
  doc.setFontSize(12);
  doc.text("Fee Breakdown", 14, 96);

  autoTable(doc, {
    startY: 99,
    head: [["Fee Type", "Amount ($)", "Terms", "Total ($)", "Type"]],
    body: aggregateFeeRows(payload.installments),
    theme: "grid",
    headStyles: { fillColor: [7, 61, 108], textColor: [255, 255, 255] },
    styles: { fontSize: 9 }
  });

  const finalY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 128;
  const totalNet = payload.installments.reduce((sum, item) => sum + item.netFee, 0);
  doc.setFillColor(7, 61, 108);
  doc.roundedRect(14, finalY + 6, 182, 12, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(`Net Total: $${currency.format(totalNet)}`, 150, finalY + 14);

  // Payment schedule
  doc.setTextColor(10, 38, 66);
  doc.setFontSize(12);
  doc.text("Payment Schedule", 14, finalY + 28);

  const depositRows: string[][] = payload.deposit
    ? [
        [
          "D",
          "Deposit",
          formatReadableDate(payload.deposit.due),
          `$${currency.format(payload.deposit.amount)}`,
          collectedByLabel(payload.deposit.collected_by)
        ]
      ]
    : [];

  const installmentRows = payload.installments.map((item, index) => [
    String(index + 1),
    item.installmentName,
    formatReadableDate(item.installmentDate),
    `$${currency.format(item.netFee)}`,
    collectedByLabel(item.collected_by)
  ]);

  autoTable(doc, {
    startY: finalY + 31,
    head: [["#", "Name", "Due Date", "Amount ($)", "Collected By"]],
    body: [...depositRows, ...installmentRows],
    theme: "grid",
    headStyles: { fillColor: [24, 124, 227], textColor: [255, 255, 255] },
    styles: { fontSize: 10 }
  });

  return Buffer.from(doc.output("arraybuffer"));
}
