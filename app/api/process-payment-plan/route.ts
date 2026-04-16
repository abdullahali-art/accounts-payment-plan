import { NextResponse } from "next/server";
import {
  createPlanSummaryString,
  formatReadableDate,
  generatePdfBuffer,
  PaymentPlanBody
} from "@/lib/payment-plan-pdf";
import { getContactEmail, getEnv, getPdfContext, fetchFieldSchemaMap, normalise } from "@/lib/ghl-context";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GHL_OPP_VERSION = "2021-07-28";
const GHL_CONV_VERSION = "2021-04-15";
const N8N_WEBHOOK_URL = getEnv("N8N_WEBHOOK_URL");

// ---------------------------------------------------------------------------
// GHL types
// ---------------------------------------------------------------------------

// GHL writes by field GUID (id) when available; falls back to key for safety
type GhlCustomField = { id?: string; key?: string; field_value: string };

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

type GhlPipeline = {
  id?: string;
  _id?: string;
  name?: string;
  pipelineName?: string;
  stages?: unknown;
  pipelineStages?: unknown;
};

type OrderedStage = { id: string; name: string; position: number };

// ---------------------------------------------------------------------------
// GHL helpers
// ---------------------------------------------------------------------------

function ghlHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_OPP_VERSION,
    "Content-Type": "application/json"
  };
}

async function getOpportunity(
  apiKey: string,
  opportunityId: string
): Promise<GhlOpportunity | null> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${opportunityId}`,
    { headers: ghlHeaders(apiKey) }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const opp = (json.opportunity ?? json.data ?? json) as GhlOpportunity;
  return opp && typeof opp === "object" ? opp : null;
}

async function updateOpportunityFields(params: {
  apiKey: string;
  opportunityId: string;
  contactId: string;
  customFields: GhlCustomField[];
}) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${params.opportunityId}`,
    {
      method: "PUT",
      headers: ghlHeaders(params.apiKey),
      body: JSON.stringify({
        contactId: params.contactId,
        customFields: params.customFields
      })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL opportunity update failed: ${res.status} ${text}`);
  }
}

async function fetchAccountsPipeline(
  apiKey: string,
  locationId: string
): Promise<GhlPipeline | null> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers: ghlHeaders(apiKey) }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { pipelines?: GhlPipeline[] };
  return (
    (data.pipelines ?? []).find(
      (p) =>
        String(p.name ?? p.pipelineName ?? "")
          .trim()
          .toLowerCase() === "accounts"
    ) ?? null
  );
}

function extractOrderedStages(pipeline: GhlPipeline): OrderedStage[] {
  const raw = pipeline.stages ?? pipeline.pipelineStages;
  if (!Array.isArray(raw)) return [];
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

/**
 * Advance the specific opportunity to the next stage in the Accounts pipeline.
 * Only touches the single opp_id — does NOT touch other opportunities.
 */
async function advanceOpportunityStage(params: {
  apiKey: string;
  locationId: string;
  opportunityId: string;
}): Promise<{ advanced: boolean; skippedReason?: string }> {
  const pipeline = await fetchAccountsPipeline(params.apiKey, params.locationId);
  if (!pipeline) {
    return { advanced: false, skippedReason: "Accounts pipeline not found." };
  }

  const pipelineId = String(pipeline.id ?? pipeline._id ?? "");
  if (!pipelineId) {
    return { advanced: false, skippedReason: "Accounts pipeline id missing." };
  }

  const stages = extractOrderedStages(pipeline);
  const explicitTarget = getEnv("GHL_ACCOUNTS_TARGET_STAGE_ID");

  const opp = await getOpportunity(params.apiKey, params.opportunityId);
  if (!opp) {
    return { advanced: false, skippedReason: "Opportunity not found." };
  }

  const currentStageId = String(opp.pipelineStageId ?? opp.pipeline_stage_id ?? "");

  const oppPipelineId = String(opp.pipelineId ?? opp.pipeline_id ?? "");

  // Resolve next stage
  let nextStageId: string | undefined;
  if (explicitTarget) {
    nextStageId =
      explicitTarget !== currentStageId &&
      (stages.length === 0 || stages.some((s) => s.id === explicitTarget))
        ? explicitTarget
        : undefined;
  } else if (oppPipelineId !== pipelineId && stages.length > 0) {
    nextStageId = stages[0]?.id;
  } else {
    const idx = stages.findIndex((s) => s.id === currentStageId);
    if (idx >= 0 && idx < stages.length - 1) {
      nextStageId = stages[idx + 1]?.id;
    } else if (idx < 0 && stages.length > 0) {
      nextStageId = stages[0]?.id;
    }
  }

  if (!nextStageId) {
    return {
      advanced: false,
      skippedReason: `Already at last stage. Pipeline: ${pipelineId}, current stage: ${currentStageId}, opp pipeline: ${oppPipelineId}, stages: ${stages.map(s => s.id).join(",")}`
    };
  }

  const contactId = String(opp.contactId ?? "");
  const body: Record<string, unknown> = {
    contactId,
    pipelineId,
    pipelineStageId: nextStageId,
    name: opp.name ?? "",
    status: opp.status ?? "open",
    monetaryValue: typeof opp.monetaryValue === "number" ? opp.monetaryValue : 0
  };
  if (opp.assignedTo) body.assignedTo = opp.assignedTo;
  if (Array.isArray(opp.customFields) && opp.customFields.length > 0) {
    body.customFields = opp.customFields;
  }

  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/${params.opportunityId}`,
    {
      method: "PUT",
      headers: ghlHeaders(params.apiKey),
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL stage advance failed: ${res.status} ${text}`);
  }

  return { advanced: true };
}

/**
 * Upload a PDF to GHL conversations and return the hosted URL.
 */
async function uploadPdfToGhl(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
  pdfBuffer: Buffer;
  fileName: string;
}): Promise<string> {
  const form = new FormData();
  form.append("contactId", params.contactId);
  form.append("locationId", params.locationId);
  form.append(
    "fileAttachment",
    new Blob([new Uint8Array(params.pdfBuffer)], { type: "application/pdf" }),
    params.fileName
  );

  const res = await fetch(
    "https://services.leadconnectorhq.com/conversations/messages/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_CONV_VERSION
      },
      body: form
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL PDF upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { uploadedFiles?: Record<string, string> };
  if (!data.uploadedFiles) {
    throw new Error("GHL PDF upload response missing uploadedFiles.");
  }
  const url =
    data.uploadedFiles[params.fileName] ||
    Object.values(data.uploadedFiles)[0] ||
    "";
  if (!url) throw new Error("GHL PDF upload succeeded but returned no URL.");
  return url;
}

/**
 * Send an email with PDF attachment via GHL conversations.
 */
async function sendEmailWithPdf(params: {
  apiKey: string;
  locationId: string;
  contactId: string;
  emailTo: string;
  subject: string;
  html: string;
  attachmentUrls: string[];
}) {
  const res = await fetch(
    "https://services.leadconnectorhq.com/conversations/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_CONV_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "Email",
        contactId: params.contactId,
        subject: params.subject,
        html: params.html,
        emailTo: params.emailTo,
        attachments: params.attachmentUrls
      })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL email send failed: ${res.status} ${text}`);
  }
}

/**
 * Create a GHL task on a contact. Non-fatal — errors are swallowed.
 */
async function createGhlTask(params: {
  apiKey: string;
  contactId: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = tomorrow.toISOString();

    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/${params.contactId}/tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          Version: GHL_OPP_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          dueDate,
          completed: false
        })
      }
    );
    if (!res.ok) {
      const text = await res.text();
      console.warn(`GHL task creation failed: ${res.status} ${text}`);
    }
  } catch (err) {
    console.warn("GHL task creation error:", err);
  }
}

/**
 * POST the full JSON blob to the n8n webhook. Non-fatal — errors are swallowed.
 */
async function postToN8nWebhook(payload: unknown): Promise<void> {
  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`n8n webhook responded ${res.status}: ${text}`);
    }
  } catch (err) {
    console.warn("n8n webhook error:", err);
  }
}

// ---------------------------------------------------------------------------
// Business logic — build the Section 7 JSON blob
// ---------------------------------------------------------------------------

function buildJsonBlob(body: PaymentPlanBody, xeroTrackingCode: string) {
  const {
    opp_id,
    contact_id,
    program_offer_id = "",
    commission_pct = 0,
    deposit,
    installments
  } = body;

  // Plan-level financials
  const grossFeeFromInstallments = installments.reduce((s, i) => s + i.feeAmount, 0);
  const depositAmount = deposit?.amount ?? 0;
  const grossFee = grossFeeFromInstallments + depositAmount;
  const discountAmount = installments.reduce((s, i) => s + i.discount, 0);
  const netFee = Math.round((grossFee - discountAmount) * 100) / 100;
  const commissionAmount = Math.round(netFee * commission_pct * 10) / 1000;
  const universityPortion = Math.round((netFee - commissionAmount) * 100) / 100;

  // payment_model
  const collectedByValues = [
    ...(deposit ? [deposit.collected_by] : []),
    ...installments.map((i) => i.collected_by ?? "us")
  ];
  const allUs = collectedByValues.every((v) => v === "us");
  const allUni = collectedByValues.every((v) => v === "university");
  const paymentModel: "us" | "university" | "mixed" = allUs
    ? "us"
    : allUni
      ? "university"
      : "mixed";

  // Deposit object
  const depositBlob = deposit
    ? {
        amount: deposit.amount,
        due: deposit.due,
        collected_by: deposit.collected_by,
        status: "unpaid",
        amount_paid: 0,
        amount_outstanding: deposit.amount,
        xero_invoice_id: "",
        xero_contact_id: "",
        payments: []
      }
    : null;

  // Installments array
  const installmentsBlob = installments.map((inst, idx) => ({
    no: idx + 1,
    amount: inst.netFee,
    due: inst.installmentDate,
    collected_by: inst.collected_by ?? "us",
    status: "unpaid",
    amount_paid: 0,
    amount_outstanding: inst.netFee,
    xero_invoice_id: "",
    payments: []
  }));

  // outstanding_balance = all amounts initially unpaid
  const outstandingBalance = netFee;

  // next_due: earliest due date across deposit + installments
  const allDueItems: { due: string; amount: number }[] = [
    ...(deposit ? [{ due: deposit.due, amount: deposit.amount }] : []),
    ...installments.map((i) => ({ due: i.installmentDate, amount: i.netFee }))
  ].sort((a, b) => a.due.localeCompare(b.due));

  const nextDueDate = allDueItems[0]?.due ?? "";
  const nextDueAmount = allDueItems[0]?.amount ?? 0;
  const installmentsRemaining = installments.length;

  const now = new Date().toISOString();

  const blob = {
    schema_version: "1.0",
    opportunity_id: opp_id,
    contact_id,
    xero_tracking_code: xeroTrackingCode,
    program_offer_id,
    gross_fee: grossFee,
    discount: discountAmount,
    net_fee: netFee,
    commission_pct: commission_pct,
    commission_amount: commissionAmount,
    university_portion: universityPortion,
    payment_model: paymentModel,
    deposit: depositBlob,
    installments: installmentsBlob,
    outstanding_balance: outstandingBalance,
    total_paid: 0,
    commission_received: false,
    commission_received_date: "",
    university_portion_sent: false,
    university_portion_sent_date: "",
    amendment_log: [],
    created_at: now,
    updated_at: now,
    original_schedule_hash: ""
  };

  return {
    blob,
    grossFee,
    discountAmount,
    netFee,
    commissionAmount,
    universityPortion,
    paymentModel,
    depositAmount,
    nextDueDate,
    nextDueAmount,
    installmentsRemaining
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PaymentPlanBody;
    const { opp_id, contact_id, installments, deposit } = body;

    if (!opp_id || !contact_id || !Array.isArray(installments) || installments.length === 0) {
      return NextResponse.json(
        { error: "opp_id, contact_id and at least one installment are required." },
        { status: 400 }
      );
    }

    const ghlApiKey = getEnv("GHL_API_KEY");
    const ghlLocationId = getEnv("GHL_LOCATION_ID", "GHL_sub-account_Location");

    if (!ghlApiKey) {
      throw new Error("Missing GHL_API_KEY in environment variables.");
    }
    if (!ghlLocationId) {
      throw new Error("Missing GHL_LOCATION_ID in environment variables.");
    }

    // ── 1. Build xero_tracking_code ──────────────────────────────────────
    const xeroTrackingCode = body.xero_tracking_code ?? "";

    // ── 1b. Fetch GHL field schema to resolve keys → GUIDs for writes ────
    // GHL's opportunity API returns/accepts custom fields by GUID, not key name.
    const fieldSchemaMap = await fetchFieldSchemaMap({ apiKey: ghlApiKey, locationId: ghlLocationId });
    // Reverse map: normalised key → field GUID
    const keyToId = new Map<string, string>();
    for (const [id, key] of fieldSchemaMap) {
      keyToId.set(normalise(key), id);
    }
    // Helper: build a custom field entry using GUID when available, key as fallback
    const cf = (key: string, field_value: string): GhlCustomField => {
      const id = keyToId.get(normalise(key));
      return id ? { id, field_value } : { key, field_value };
    };

    // ── 2. Build Section 7 JSON blob ─────────────────────────────────────
    const {
      blob,
      grossFee,
      discountAmount,
      netFee,
      commissionAmount,
      universityPortion,
      paymentModel,
      depositAmount,
      nextDueDate,
      nextDueAmount,
      installmentsRemaining
    } = buildJsonBlob(body, xeroTrackingCode);

    // ── 3. Derive payment_plan_app_link ──────────────────────────────────
    const appBaseUrl = getEnv("APP_BASE_URL");
    const paymentPlanAppLink = appBaseUrl
      ? `${appBaseUrl}/?opp_id=${opp_id}&contact_id=${contact_id}`
      : "";

    // ── 4. Build human-readable schedule for "Original Schedule JSON" ────
    const scheduleLines: string[] = [];
    if (deposit && depositAmount > 0) {
      scheduleLines.push(`Deposit: $${depositAmount.toFixed(2)} — due ${formatReadableDate(deposit.due)} (${deposit.collected_by === "university" ? "University" : "The Migration"})`);
    }
    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      scheduleLines.push(`#${i + 1} ${inst.installmentName}: $${inst.netFee.toFixed(2)} — due ${formatReadableDate(inst.installmentDate)} (${inst.collected_by === "university" ? "University" : "The Migration"})`);
    }
    const readableSchedule = [
      `Gross Fee: $${grossFee.toFixed(2)}`,
      `Discount: $${discountAmount.toFixed(2)}`,
      `Net Fee: $${netFee.toFixed(2)}`,
      `Commission: ${body.commission_pct ?? 0}% = $${commissionAmount.toFixed(2)}`,
      `Payment Model: ${paymentModel}`,
      "",
      ...scheduleLines
    ].join("\n");

    // ── 5. Build GHL custom fields payload (all Section 5 keys) ──────────
    const customFields: GhlCustomField[] = [
      cf("opportunity.installment_schedule_json", JSON.stringify(blob)),
      cf("opportunity.original_schedule_json",    readableSchedule),
      cf("opportunity.gross_fee",                 grossFee.toFixed(2)),
      cf("opportunity.discount_amount",           discountAmount.toFixed(2)),
      cf("opportunity.net_fee",                   netFee.toFixed(2)),
      cf("opportunity.commission_pct",            String(body.commission_pct ?? 0)),
      cf("opportunity.commission_amount",         commissionAmount.toFixed(2)),
      cf("opportunity.university_portion",        universityPortion.toFixed(2)),
      cf("opportunity.payment_model",             paymentModel),
      cf("opportunity.outstanding_balance",       netFee.toFixed(2)),
      cf("opportunity.next_due_date",             nextDueDate),
      cf("opportunity.next_due_amount",           nextDueAmount.toFixed(2)),
      cf("opportunity.installments_remaining",    String(installmentsRemaining)),
      cf("opportunity.fully_paid",                "false"),
      cf("opportunity.commission_received",       "false"),
      cf("opportunity.university_portion_sent",   "false")
    ];

    // Conditional fields (only write if we have data)
    if (xeroTrackingCode) {
      customFields.push(cf("opportunity.xero_tracking_code", xeroTrackingCode));
    }
    if (deposit && depositAmount > 0) {
      customFields.push(cf("opportunity.deposit_amount",   depositAmount.toFixed(2)));
      customFields.push(cf("opportunity.deposit_due_date", deposit.due));
    }
    if (body.program_offer_id) {
      customFields.push(cf("opportunity.program_offer_id", body.program_offer_id));
    }
    if (paymentPlanAppLink) {
      customFields.push(cf("opportunity.generate_pay_plan", paymentPlanAppLink));
    }

    // ── 5. Write all fields to GHL opportunity ───────────────────────────
    await updateOpportunityFields({
      apiKey: ghlApiKey,
      opportunityId: opp_id,
      contactId: contact_id,
      customFields
    });

    // ── 6. Generate PDF ──────────────────────────────────────────────────
    const pdfContext = await getPdfContext({
      apiKey: ghlApiKey,
      oppId: opp_id,
      contactId: contact_id
    });
    const pdfBuffer = generatePdfBuffer(body, pdfContext);
    const pdfFileName = `payment-plan-${opp_id}.pdf`;

    // ── 7. Upload PDF to GHL conversations ───────────────────────────────
    const uploadedPdfUrl = await uploadPdfToGhl({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      contactId: contact_id,
      pdfBuffer,
      fileName: pdfFileName
    });

    // ── 8. Get contact email and send email ──────────────────────────────
    const contactEmail = await getContactEmail({
      apiKey: ghlApiKey,
      contactId: contact_id
    });
    if (!contactEmail) {
      throw new Error("Could not resolve contact email from GHL contact record.");
    }

    const planSummary = createPlanSummaryString(installments);

    await sendEmailWithPdf({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      contactId: contact_id,
      emailTo: contactEmail,
      subject: "Your Payment Plan",
      html: `<p>Dear student,</p><p>Please find your payment plan attached.</p><p><strong>Plan Summary:</strong><br>${planSummary.replace(/ \| /g, "<br>")}</p><p>If you have any questions, please contact our team.</p>`,
      attachmentUrls: [uploadedPdfUrl]
    });

    // ── 9. POST to n8n webhook (non-fatal) ───────────────────────────────
    if (N8N_WEBHOOK_URL) {
      await postToN8nWebhook(blob);
    }

    // ── 10. Create GHL accounts task (non-fatal) ─────────────────────────
    const studentName = pdfContext.studentName || contact_id;
    await createGhlTask({
      apiKey: ghlApiKey,
      contactId: contact_id,
      title: `Review payment plan — ${studentName}`,
      body: `Payment plan submitted and PDF emailed. Review Xero invoices once n8n automation creates them.\n\nTracking code: ${xeroTrackingCode || "pending"}\nNet fee: $${netFee.toFixed(2)}\nPayment model: ${paymentModel}`
    });

    // ── 11. Advance Accounts pipeline stage for this opportunity ─────────
    const stageResult = await advanceOpportunityStage({
      apiKey: ghlApiKey,
      locationId: ghlLocationId,
      opportunityId: opp_id
    });

    // ── 12. Return success ───────────────────────────────────────────────
    return NextResponse.json({
      message:
        "Payment plan saved to GHL, PDF emailed, n8n webhook triggered, and stage advanced.",
      data: {
        opp_id,
        contact_id,
        xero_tracking_code: xeroTrackingCode,
        payment_model: paymentModel,
        gross_fee: grossFee,
        net_fee: netFee,
        commission_amount: commissionAmount,
        university_portion: universityPortion,
        outstanding_balance: netFee,
        next_due_date: nextDueDate,
        next_due_amount: nextDueAmount,
        installments_remaining: installmentsRemaining,
        email_to: contactEmail,
        uploaded_pdf_url: uploadedPdfUrl,
        stage_advanced: stageResult.advanced,
        stage_note: stageResult.skippedReason
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
