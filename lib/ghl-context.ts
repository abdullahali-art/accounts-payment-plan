import { PaymentPlanPdfContext } from "@/lib/payment-plan-pdf";
type AnyRecord = Record<string, unknown>;

export function getEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function asRecord(value: unknown): AnyRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AnyRecord;
  }
  return null;
}

function findProgramOffer(opportunity: AnyRecord): string {
  const customFields = opportunity.customFields;
  if (Array.isArray(customFields)) {
    for (const field of customFields) {
      const item = asRecord(field);
      if (!item) continue;
      const key = String(item.key ?? item.name ?? item.fieldKey ?? "").toLowerCase();
      if (key.includes("programoffer") || key.includes("program_offer") || key.includes("program offer")) {
        const value = item.field_value ?? item.value ?? item.fieldValue;
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
  }

  const directCandidates = ["programoffer", "program_offer", "programOffer", "application"];
  for (const candidate of directCandidates) {
    const value = opportunity[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function pickApplicationFromProperties(properties: AnyRecord): string {
  const preferredKeys = ["program_offer", "program", "application", "product", "name"];
  for (const key of preferredKeys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(properties)) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

async function findProgramOfferFromAssociatedObject(params: {
  apiKey: string;
  locationId: string;
  opportunityId: string;
}): Promise<string> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${params.apiKey}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };

  const objectsRes = await fetch(
    `https://services.leadconnectorhq.com/objects/?locationId=${encodeURIComponent(params.locationId)}`,
    { headers }
  );
  if (!objectsRes.ok) {
    return "";
  }

  const objectsJson = (await objectsRes.json()) as { objects?: Array<AnyRecord> };
  const customObjectKeys = (objectsJson.objects || [])
    .map((obj) => String(obj.key ?? ""))
    .filter((key) => key.startsWith("custom_objects."));

  if (customObjectKeys.length === 0) {
    return "";
  }

  const prioritizedKeys = [
    ...customObjectKeys.filter((key) => key.includes("programoffer") || key.includes("program_offer")),
    ...customObjectKeys.filter((key) => key.includes("products")),
    ...customObjectKeys
  ].filter((key, index, arr) => arr.indexOf(key) === index);

  for (const schemaKey of prioritizedKeys) {
    for (let page = 1; page <= 5; page += 1) {
      const recordsRes = await fetch(
        `https://services.leadconnectorhq.com/objects/${encodeURIComponent(schemaKey)}/records/search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            locationId: params.locationId,
            page,
            pageLimit: 30
          })
        }
      );
      if (!recordsRes.ok) {
        break;
      }

      const recordsJson = (await recordsRes.json()) as { records?: Array<AnyRecord> };
      const matched = recordsJson.records?.find((record) => {
        const relations = Array.isArray(record.relations) ? record.relations : [];
        return relations.some((rel) => {
          const relation = asRecord(rel);
          return (
            String(relation?.objectKey ?? "").toLowerCase() === "opportunity" &&
            String(relation?.recordId ?? "") === params.opportunityId
          );
        });
      });

      if (matched) {
        const properties = asRecord(matched.properties) || {};
        return pickApplicationFromProperties(properties);
      }
    }
  }

  return "";
}

export async function getPdfContext(params: {
  apiKey: string;
  oppId: string;
  contactId: string;
}): Promise<PaymentPlanPdfContext> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${params.apiKey}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };

  const [oppRes, contactRes] = await Promise.all([
    fetch(`https://services.leadconnectorhq.com/opportunities/${params.oppId}`, { headers }),
    fetch(`https://services.leadconnectorhq.com/contacts/${params.contactId}`, { headers })
  ]);

  const context: PaymentPlanPdfContext = {};

  if (oppRes.ok) {
    const oppJson = (await oppRes.json()) as AnyRecord;
    const opportunity = asRecord(oppJson.opportunity) || asRecord(oppJson.data) || oppJson;
    const directApplication = findProgramOffer(opportunity);
    const locationId = String(opportunity.locationId ?? getEnv("GHL_sub-account_Location", "GHL_LOCATION_ID"));
    context.application =
      directApplication ||
      (await findProgramOfferFromAssociatedObject({
        apiKey: params.apiKey,
        locationId,
        opportunityId: params.oppId
      }));
  }

  if (contactRes.ok) {
    const contactJson = (await contactRes.json()) as {
      contact?: { firstName?: string; lastName?: string; email?: string; name?: string };
      data?: { firstName?: string; lastName?: string; email?: string; name?: string };
    };
    const contact = contactJson.contact || contactJson.data;
    const fullName = `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() || contact?.name || "";
    context.studentName = fullName;
    context.studentEmail = contact?.email || "";
  }

  return context;
}

export async function getContactEmail(params: { apiKey: string; contactId: string }): Promise<string> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${params.apiKey}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };
  const response = await fetch(
    `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(params.contactId)}`,
    { headers }
  );
  if (!response.ok) {
    return "";
  }
  const data = (await response.json()) as { contact?: { email?: string }; email?: string };
  return data.contact?.email || data.email || "";
}
