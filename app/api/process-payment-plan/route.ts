import { NextResponse } from "next/server";
import {
  createPlanSummaryString,
  generatePdfBuffer,
  PaymentPlanBody
} from "@/lib/payment-plan-pdf";
import { getContactEmail, getEnv, getPdfContext } from "@/lib/ghl-context";

const GHL_CONVERSATIONS_VERSION = "2021-04-15";

type GhlCustomFieldEntry = {
  key?: string;
  id?: string;
  field_value: string;
};

type GhlPipeline = {
  id?: string;
  _id?: string;
  name?: string;
  pipelineName?: string;
};

type GhlOpportunity = {
  id?: string;
  _id?: string;
  pipelineId?: string;
  pipeline_id?: string;
};

async function updateGhlOpportunity(params: {
  opportunityId: string;
  contactId: string;
  apiKey: string;
  customFields: GhlCustomFieldEntry[];
}) {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${params.opportunityId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contactId: params.contactId,
        customFields: params.customFields
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL opportunity update failed: ${response.status} ${errorText}`);
  }
}

async function findAccountsPipelineId(params: {
  apiKey: string;
  locationId: string;
}): Promise<string> {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(
      params.locationId
    )}`,
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    return "";
  }

  const data = (await response.json()) as { pipelines?: GhlPipeline[] };
  const pipelines = Array.isArray(data.pipelines) ? data.pipelines : [];
  const accounts = pipelines.find((p) => {
    const name = String(p.name ?? p.pipelineName ?? "").trim().toLowerCase();
    return name === "accounts";
  });
  return String(accounts?.id ?? accounts?._id ?? "");
}

async function findContactOpportunitiesInPipeline(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
  pipelineId: string;
}): Promise<string[]> {
  const url = new URL("https://services.leadconnectorhq.com/opportunities/search");
  url.searchParams.set("location_id", params.locationId);
  url.searchParams.set("contact_id", params.contactId);
  url.searchParams.set("pipeline_id", params.pipelineId);
  url.searchParams.set("limit", "100");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      Version: "2021-07-28",
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { opportunities?: GhlOpportunity[] };
  const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
  return opportunities
    .map((opp) => String(opp.id ?? opp._id ?? ""))
    .filter((id) => id.length > 0);
}

async function syncAccountsPipelineOpportunityFields(params: {
  apiKey: string;
  locationId: string;
  sourceOpportunityId: string;
  contactId: string;
  customFields: GhlCustomFieldEntry[];
}) {
  const accountsPipelineId = await findAccountsPipelineId({
    apiKey: params.apiKey,
    locationId: params.locationId
  });
  if (!accountsPipelineId) return;

  const opportunityIds = await findContactOpportunitiesInPipeline({
    apiKey: params.apiKey,
    locationId: params.locationId,
    contactId: params.contactId,
    pipelineId: accountsPipelineId
  });

  const targets = opportunityIds.filter((id) => id !== params.sourceOpportunityId);
  await Promise.all(
    targets.map((opportunityId) =>
      updateGhlOpportunity({
        opportunityId,
        contactId: params.contactId,
        apiKey: params.apiKey,
        customFields: params.customFields
      })
    )
  );
}

async function uploadPdfAttachmentToGhl(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
  pdfBuffer: Buffer;
  fileName: string;
}): Promise<string> {
  const form = new FormData();
  form.append("contactId", params.contactId);
  form.append("locationId", params.locationId);
  const pdfBytes = new Uint8Array(params.pdfBuffer);
  form.append(
    "fileAttachment",
    new Blob([pdfBytes], { type: "application/pdf" }),
    params.fileName
  );

  const response = await fetch(
    "https://services.leadconnectorhq.com/conversations/messages/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_CONVERSATIONS_VERSION
      },
      body: form
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL attachment upload failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    uploadedFiles?: Record<string, string>;
  };

  if (!data.uploadedFiles || typeof data.uploadedFiles !== "object") {
    throw new Error(
      "GHL attachment upload response missing uploadedFiles. Raw: " +
        JSON.stringify(data).slice(0, 500)
    );
  }

  const uploadedUrl =
    data.uploadedFiles[params.fileName] ||
    Object.values(data.uploadedFiles)[0] ||
    "";

  if (!uploadedUrl) {
    throw new Error("GHL attachment upload succeeded but no file URL was returned.");
  }
  return uploadedUrl;
}

async function sendGhlEmailWithAttachment(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
  emailTo: string;
  subject: string;
  html: string;
  attachmentUrls: string[];
}) {
  const payload = {
    type: "Email",
    contactId: params.contactId,
    subject: params.subject,
    html: params.html,
    emailTo: params.emailTo,
    attachments: params.attachmentUrls
  };

  const response = await fetch(
    "https://services.leadconnectorhq.com/conversations/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_CONVERSATIONS_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL email send failed: ${response.status} ${errorText}`);
  }
}

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

    const firstInstallment = installments[0];
    const firstInstallmentDate = firstInstallment.installmentDate;
    const firstInstallmentAmount = firstInstallment.netFee;

    const ghlApiKey = getEnv("GHL_API_KEY");
    const ghlLocationId = getEnv("GHL_LOCATION_ID", "GHL_sub-account_Location");

    if (!ghlApiKey) {
      throw new Error("Missing GHL_API_KEY in environment variables.");
    }
    if (!ghlLocationId) {
      throw new Error("Missing GHL sub-account location id in environment variables.");
    }

    const pdfContext = await getPdfContext({ apiKey: ghlApiKey, oppId: opp_id, contactId: contact_id });
    const pdfBuffer = generatePdfBuffer(body, pdfContext);
    const paymentPlanSummary = createPlanSummaryString(installments);
    const nextInstallmentDate = firstInstallmentDate;
    const pdfFileName = `payment-plan-${opp_id}.pdf`;

    const ghlCustomFields: GhlCustomFieldEntry[] = [
      { id: "0Yf7bCEtX8Jq21ToM8DD", field_value: paymentPlanSummary },
      { id: "Xl6Z2dbpAIXDuqK2v6L6", field_value: nextInstallmentDate }
    ];

    await updateGhlOpportunity({
      opportunityId: opp_id,
      contactId: contact_id,
      apiKey: ghlApiKey,
      customFields: ghlCustomFields
    });
    await syncAccountsPipelineOpportunityFields({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      sourceOpportunityId: opp_id,
      contactId: contact_id,
      customFields: ghlCustomFields
    });

    const uploadedPdfUrl = await uploadPdfAttachmentToGhl({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      contactId: contact_id,
      pdfBuffer,
      fileName: pdfFileName
    });

    const contactEmail = await getContactEmail({ apiKey: ghlApiKey, contactId: contact_id });
    if (!contactEmail) {
      throw new Error("Could not resolve contact email from GHL contact record.");
    }

    await sendGhlEmailWithAttachment({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      contactId: contact_id,
      emailTo: contactEmail,
      subject: "Your Payment Plan",
      html: `<p>Please find your payment plan attached.</p><p><strong>Summary:</strong> ${paymentPlanSummary}</p>`,
      attachmentUrls: [uploadedPdfUrl]
    });

    return NextResponse.json({
      message: "Payment plan generated, GHL updated, and email sent with PDF attachment.",
      data: {
        opp_id,
        contact_id,
        payment_plan_summary: paymentPlanSummary,
        next_installment_date: nextInstallmentDate,
        first_installment_date: firstInstallmentDate,
        first_installment_amount: firstInstallmentAmount,
        pdf_file_name: pdfFileName,
        pdf_bytes: pdfBuffer.length,
        email_to: contactEmail,
        uploaded_pdf_url: uploadedPdfUrl
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
