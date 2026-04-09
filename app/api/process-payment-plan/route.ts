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
  stages?: unknown;
  pipelineStages?: unknown;
};

type GhlOpportunity = {
  id?: string;
  _id?: string;
  pipelineId?: string;
  pipeline_id?: string;
  pipelineStageId?: string;
  pipeline_stage_id?: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  assignedTo?: string;
  contactId?: string;
  customFields?: unknown;
};

type OrderedStage = { id: string; name: string; position: number };

const GHL_OPPORTUNITIES_VERSION = "2021-07-28";

function extractOrderedStages(pipeline: GhlPipeline): OrderedStage[] {
  const raw = pipeline.stages ?? pipeline.pipelineStages;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, index) => {
      const s = item as Record<string, unknown>;
      const id = String(s.id ?? s._id ?? "");
      const name = String(s.name ?? "");
      const position =
        typeof s.position === "number"
          ? s.position
          : typeof s.order === "number"
            ? (s.order as number)
            : index;
      return { id, name, position };
    })
    .filter((x) => x.id.length > 0)
    .sort((a, b) => a.position - b.position);
}

async function getGhlOpportunity(params: { apiKey: string; opportunityId: string }): Promise<GhlOpportunity | null> {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${params.opportunityId}`,
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_OPPORTUNITIES_VERSION,
        "Content-Type": "application/json"
      }
    }
  );
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as Record<string, unknown>;
  const opp = (json.opportunity ?? json.data ?? json) as GhlOpportunity;
  return opp && typeof opp === "object" ? opp : null;
}

async function putGhlOpportunityFull(params: {
  opportunityId: string;
  apiKey: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${params.opportunityId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_OPPORTUNITIES_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params.body)
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL opportunity stage update failed: ${response.status} ${errorText}`);
  }
}

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
        Version: GHL_OPPORTUNITIES_VERSION,
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

async function fetchAccountsPipeline(params: {
  apiKey: string;
  locationId: string;
}): Promise<GhlPipeline | null> {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(
      params.locationId
    )}`,
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_OPPORTUNITIES_VERSION,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { pipelines?: GhlPipeline[] };
  const pipelines = Array.isArray(data.pipelines) ? data.pipelines : [];
  const accounts = pipelines.find((p) => {
    const name = String(p.name ?? p.pipelineName ?? "").trim().toLowerCase();
    return name === "accounts";
  });
  return accounts ?? null;
}

async function findAccountsPipelineId(params: {
  apiKey: string;
  locationId: string;
}): Promise<string> {
  const pipeline = await fetchAccountsPipeline(params);
  return String(pipeline?.id ?? pipeline?._id ?? "");
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
      Version: GHL_OPPORTUNITIES_VERSION,
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

function resolveNextStageId(
  stages: OrderedStage[],
  currentStageId: string,
  explicitTargetStageId: string
): string | undefined {
  if (!currentStageId) {
    return undefined;
  }
  if (
    explicitTargetStageId &&
    stages.some((s) => s.id === explicitTargetStageId) &&
    explicitTargetStageId !== currentStageId
  ) {
    return explicitTargetStageId;
  }
  const idx = stages.findIndex((s) => s.id === currentStageId);
  if (idx < 0 || idx >= stages.length - 1) {
    return undefined;
  }
  return stages[idx + 1]?.id;
}

async function advanceAccountsPipelineOpportunitiesToNextStage(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
}): Promise<{ updatedOpportunityIds: string[]; skippedReason?: string }> {
  const accountsPipeline = await fetchAccountsPipeline({
    apiKey: params.apiKey,
    locationId: params.locationId
  });
  if (!accountsPipeline) {
    return { updatedOpportunityIds: [], skippedReason: "Accounts pipeline not found." };
  }

  const pipelineId = String(accountsPipeline.id ?? accountsPipeline._id ?? "");
  if (!pipelineId) {
    return { updatedOpportunityIds: [], skippedReason: "Accounts pipeline id missing." };
  }

  const explicitTarget = getEnv("GHL_ACCOUNTS_TARGET_STAGE_ID");
  const stages = extractOrderedStages(accountsPipeline);
  if (stages.length < 2 && !explicitTarget) {
    return {
      updatedOpportunityIds: [],
      skippedReason:
        "Accounts pipeline stages not available from API. Set GHL_ACCOUNTS_TARGET_STAGE_ID to your Payment Plan Sent stage id, or confirm the pipeline returns stages."
    };
  }

  const opportunityIds = await findContactOpportunitiesInPipeline({
    apiKey: params.apiKey,
    locationId: params.locationId,
    contactId: params.contactId,
    pipelineId
  });

  const updatedOpportunityIds: string[] = [];

  for (const opportunityId of opportunityIds) {
    const opp = await getGhlOpportunity({ apiKey: params.apiKey, opportunityId });
    if (!opp) continue;

    const oppPipelineId = String(opp.pipelineId ?? opp.pipeline_id ?? "");
    if (oppPipelineId !== pipelineId) continue;

    const currentStageId = String(opp.pipelineStageId ?? opp.pipeline_stage_id ?? "");
    let nextStageId: string | undefined;
    if (explicitTarget && stages.length === 0) {
      nextStageId = explicitTarget !== currentStageId ? explicitTarget : undefined;
    } else {
      nextStageId = resolveNextStageId(stages, currentStageId, explicitTarget);
    }
    if (!nextStageId) continue;

    const contactId = String(opp.contactId ?? params.contactId);
    const body: Record<string, unknown> = {
      contactId,
      pipelineId,
      pipelineStageId: nextStageId,
      name: opp.name ?? "",
      status: opp.status ?? "open",
      monetaryValue: typeof opp.monetaryValue === "number" ? opp.monetaryValue : 0
    };
    if (opp.assignedTo) {
      body.assignedTo = opp.assignedTo;
    }
    if (Array.isArray(opp.customFields) && opp.customFields.length > 0) {
      body.customFields = opp.customFields;
    }

    await putGhlOpportunityFull({
      opportunityId,
      apiKey: params.apiKey,
      body
    });
    updatedOpportunityIds.push(opportunityId);
  }

  return { updatedOpportunityIds };
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
      html: "<p>Please find your payment plan attached!</p>",
      attachmentUrls: [uploadedPdfUrl]
    });

    const stageResult = await advanceAccountsPipelineOpportunitiesToNextStage({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      contactId: contact_id
    });

    return NextResponse.json({
      message:
        "Payment plan generated, GHL updated, email sent with PDF attachment, and Accounts pipeline stage advanced where applicable.",
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
        uploaded_pdf_url: uploadedPdfUrl,
        accounts_pipeline_stage_updated_ids: stageResult.updatedOpportunityIds,
        accounts_pipeline_stage_note: stageResult.skippedReason
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
