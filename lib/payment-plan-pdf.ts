import fs from "fs";
import path from "path";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Loaded once at module init — gracefully absent if file missing
let LOGO_BASE64: string | null = null;
try {
  const buf = fs.readFileSync(path.join(process.cwd(), "public", "Migration.png"));
  LOGO_BASE64 = buf.toString("base64");
} catch {
  // logo not available — header renders text-only
}

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

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14; // margin
const HEADER_H = 42; // height consumed by the repeated page header
const FOOTER_Y = PAGE_H - 10; // baseline of footer text

function drawHeader(doc: jsPDF) {
  // Logo — top left
  const logoSize = 14;
  const textX = LOGO_BASE64 ? M + logoSize + 3 : M;
  if (LOGO_BASE64) {
    doc.addImage(`data:image/png;base64,${LOGO_BASE64}`, "PNG", M, 8, logoSize, logoSize);
  }

  // Company info — right of logo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("The Migration", textX, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text("office 2, 16 Kendall street, Harris Park, NSW, 2150, Australia", textX, 20);
  doc.text("449550100", textX, 26);
  doc.text("info@themigration.com.au", textX, 32);

  // "PAYMENT SCHEDULE" — right, large blue
  doc.setFont("helvetica", "bold");
  doc.setFontSize(27);
  doc.setTextColor(30, 105, 180);
  doc.text("PAYMENT", PAGE_W - M, 20, { align: "right" });
  doc.text("SCHEDULE", PAGE_W - M, 33, { align: "right" });

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.4);
  doc.line(M, HEADER_H, PAGE_W - M, HEADER_H);
}

function drawFooter(doc: jsPDF, page: number, total: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Page ${page} of ${total}`, PAGE_W - M, FOOTER_Y, { align: "right" });
}

export function generatePdfBuffer(
  payload: PaymentPlanBody,
  context?: PaymentPlanPdfContext
): Buffer {
  const doc = new jsPDF();

  // ── Page 1 header ─────────────────────────────────────────────────────
  drawHeader(doc);

  // ── Client / Application section ──────────────────────────────────────
  const colMid = PAGE_W / 2 + 4;
  let y = HEADER_H + 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("Client Details", M, y);
  doc.text("Application Details", colMid, y);

  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(context?.studentName || "-", M, y);

  // Application name may be long — wrap it
  const appText = context?.application || "-";
  const appLines = doc.splitTextToSize(appText, PAGE_W - colMid - M);
  doc.text(appLines, colMid, y);

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(context?.studentEmail || "-", M, y);

  const sectionBottom = Math.max(y, HEADER_H + 10 + 7 + (appLines.length - 1) * 5) + 10;

  // Second divider
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.4);
  doc.line(M, sectionBottom, PAGE_W - M, sectionBottom);

  // ── "Installment Details" heading ─────────────────────────────────────
  y = sectionBottom + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("Installment Details", M, y);

  const tableStartY = y + 4;

  // ── Build table rows ──────────────────────────────────────────────────
  type Cell = string | { content: string; rowSpan?: number; styles?: Record<string, unknown> };
  const tableBody: Cell[][] = [];

  // Deposit row (if present)
  if (payload.deposit) {
    const d = payload.deposit;
    tableBody.push([
      { content: `Deposit\n${formatReadableDate(d.due)}`, styles: { valign: "middle", fontStyle: "normal" } },
      "Deposit",
      currency.format(d.amount),
      { content: `AUD ${currency.format(d.amount)}`, styles: { halign: "right", valign: "middle", fontStyle: "normal" } }
    ]);
  }

  // Installment rows
  for (const inst of payload.installments) {
    const feeLines: Array<[string, string]> = [];

    if (inst.fees && inst.fees.length > 0) {
      for (const fee of inst.fees) {
        feeLines.push([fee.feeType, currency.format(fee.feeAmount)]);
      }
    } else {
      feeLines.push([inst.feeType || "Tuition Fee", currency.format(inst.feeAmount)]);
    }

    if (inst.discount > 0) {
      feeLines.push(["Discount", `(${currency.format(inst.discount)})`]);
    }

    const rowCount = feeLines.length;
    const detailLabel = `${inst.installmentName}\n${formatReadableDate(inst.installmentDate)}`;
    const totalLabel = `AUD ${currency.format(inst.netFee)}`;

    // First row of the group: DETAILS and TOTAL span all fee rows
    tableBody.push([
      { content: detailLabel, rowSpan: rowCount, styles: { valign: "middle", fontStyle: "normal" } },
      feeLines[0][0],
      feeLines[0][1],
      { content: totalLabel, rowSpan: rowCount, styles: { halign: "right", valign: "middle", fontStyle: "normal" } }
    ]);

    // Continuation rows (no DETAILS or TOTAL cell)
    for (let i = 1; i < feeLines.length; i++) {
      tableBody.push([feeLines[i][0], feeLines[i][1]]);
    }
  }

  // Grand total
  const grandTotal =
    payload.installments.reduce((s, i) => s + i.netFee, 0) +
    (payload.deposit?.amount ?? 0);

  autoTable(doc, {
    startY: tableStartY,
    head: [["DETAILS", "FEE TYPE", "AMT (AUD)", "TOTAL"]],
    body: tableBody as Parameters<typeof autoTable>[1]["body"],
    foot: [
      [
        { content: "Grand Total", colSpan: 3, styles: { fontStyle: "bold" } },
        { content: `AUD ${currency.format(grandTotal)}`, styles: { halign: "right", fontStyle: "bold" } }
      ]
    ],
    theme: "plain",
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [40, 40, 40],
      fontStyle: "bold",
      fontSize: 9,
      lineWidth: 0.3,
      lineColor: [210, 210, 210]
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [30, 30, 30],
      fontSize: 9,
      lineWidth: 0.3,
      lineColor: [210, 210, 210]
    },
    styles: {
      fontSize: 9,
      cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
      lineColor: [210, 210, 210],
      lineWidth: 0.3,
      textColor: [50, 50, 50]
    },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 32 },
      3: { halign: "right", cellWidth: 36 }
    },
    margin: { top: HEADER_H + 4, left: M, right: M, bottom: 18 },
    showFoot: "lastPage",
    // Repeat header on continuation pages
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawHeader(doc);
      }
    }
  });

  // ── Add page footers now that total page count is known ───────────────
  const totalPages = (doc as jsPDF & { internal: { getNumberOfPages(): number } }).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return Buffer.from(doc.output("arraybuffer"));
}
