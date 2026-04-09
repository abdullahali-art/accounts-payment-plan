import { NextResponse } from "next/server";
import { generatePdfBuffer, PaymentPlanBody } from "@/lib/payment-plan-pdf";
import { getEnv, getPdfContext } from "@/lib/ghl-context";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PaymentPlanBody;
    const { opp_id, contact_id, installments } = body;

    if (!opp_id || !contact_id || !Array.isArray(installments) || installments.length === 0) {
      return NextResponse.json(
        { error: "opp_id, contact_id and at least one installment are required." },
        { status: 400 }
      );
    }

    const ghlApiKey = getEnv("GHL_API_KEY");
    const pdfContext = ghlApiKey
      ? await getPdfContext({ apiKey: ghlApiKey, oppId: opp_id, contactId: contact_id })
      : undefined;
    const pdfBuffer = generatePdfBuffer(body, pdfContext);
    const fileName = `payment-plan-${opp_id}.pdf`;
    const pdfBytes = new Uint8Array(pdfBuffer);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`,
        "Content-Length": String(pdfBuffer.length)
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
