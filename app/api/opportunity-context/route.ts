import { NextRequest, NextResponse } from "next/server";
import { getEnv, getFullGhlContext } from "@/lib/ghl-context";

export async function GET(request: NextRequest) {
  try {
    const oppId = request.nextUrl.searchParams.get("opp_id")?.trim() || "";
    const contactId = request.nextUrl.searchParams.get("contact_id")?.trim() || "";

    if (!oppId || !contactId) {
      return NextResponse.json(
        { error: "opp_id and contact_id query params are required." },
        { status: 400 }
      );
    }

    const ghlApiKey = getEnv("GHL_API_KEY");
    if (!ghlApiKey) {
      return NextResponse.json({ error: "Missing GHL_API_KEY." }, { status: 500 });
    }

    const locationId = getEnv("GHL_LOCATION_ID", "GHL_sub-account_Location");
    if (!locationId) {
      return NextResponse.json({ error: "Missing GHL_LOCATION_ID." }, { status: 500 });
    }

    const ctx = await getFullGhlContext({
      apiKey: ghlApiKey,
      locationId,
      oppId,
      contactId
    });

    return NextResponse.json({
      opportunityName: ctx.opportunityName,
      clientName: ctx.clientName,
      studentEmail: ctx.studentEmail,
      application: ctx.application,
      programOfferId: ctx.programOfferId,
      xeroCustomerNumber: ctx.xeroCustomerNumber,
      xeroTrackingCode: ctx.xeroTrackingCode
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
