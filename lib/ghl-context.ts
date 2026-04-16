import { PaymentPlanPdfContext } from "@/lib/payment-plan-pdf";

type AnyRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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

/**
 * Extract a value from a GHL custom fields array by matching any of the given
 * key/name patterns (case-insensitive substring match).
 */
/** Strip all non-alphanumeric characters so xero_contact_id == xeroContactId == "xero contact id" */
export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCustomFieldValue(customFields: unknown, ...patterns: string[]): string {
  if (!Array.isArray(customFields)) return "";
  const normPatterns = patterns.map(normalise);
  for (const field of customFields) {
    const item = asRecord(field);
    if (!item) continue;
    const key = normalise(String(item.key ?? item.fieldKey ?? item.id ?? ""));
    const name = normalise(String(item.name ?? item.label ?? ""));
    for (const norm of normPatterns) {
      if (key.includes(norm) || name.includes(norm)) {
        const rawVal =
          item.field_value ?? item.value ?? item.fieldValue ?? item.fieldValueString ?? "";
        const val = Array.isArray(rawVal) ? rawVal[0] : rawVal;
        if (typeof val === "string" && val.trim()) return val.trim();
        if (typeof val === "number") return String(val);
      }
    }
  }
  return "";
}

function fullName(contact: AnyRecord): string {
  const first = typeof contact.firstName === "string" ? contact.firstName.trim() : "";
  const last = typeof contact.lastName === "string" ? contact.lastName.trim() : "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return typeof contact.name === "string" ? contact.name.trim() : "";
}

// ---------------------------------------------------------------------------
// GHL header factory
// ---------------------------------------------------------------------------

function ghlHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };
}

// ---------------------------------------------------------------------------
// Field schema helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the location's custom-field schema and return a Map<fieldId, fieldKey>.
 * GHL contact/opportunity APIs return customFields as bare {id, value} without key names.
 * This map lets us resolve those IDs to human-readable keys like "contact.xero_contact_id".
 */
export async function fetchFieldSchemaMap(params: {
  apiKey: string;
  locationId: string;
}): Promise<Map<string, string>> {
  const base = `https://services.leadconnectorhq.com/locations/${encodeURIComponent(params.locationId)}/customFields`;
  const headers = ghlHeaders(params.apiKey);

  const [contactRes, oppRes] = await Promise.all([
    fetch(base, { headers }),
    fetch(`${base}?model=opportunity`, { headers })
  ]);

  const map = new Map<string, string>();

  for (const res of [contactRes, oppRes]) {
    if (!res.ok) continue;
    const json = (await res.json()) as { customFields?: AnyRecord[] };
    for (const field of json.customFields ?? []) {
      const item = asRecord(field);
      if (!item) continue;
      const id = String(item.id ?? "");
      const key = String(item.key ?? item.fieldKey ?? "");
      if (id && key) map.set(id, key);
    }
  }

  return map;
}

/**
 * Enrich a GHL customFields array by injecting the resolved `key` for items
 * that only carry an `id` (the bare format returned by Contacts/Opportunities APIs).
 */
function enrichCustomFields(customFields: unknown, schemaMap: Map<string, string>): AnyRecord[] {
  if (!Array.isArray(customFields)) return [];
  return customFields.map((field) => {
    const item = asRecord(field) ?? {};
    if (item.key || item.fieldKey) return item;
    const id = String(item.id ?? "");
    const resolvedKey = schemaMap.get(id) ?? "";
    return resolvedKey ? { ...item, key: resolvedKey, fieldKey: resolvedKey } : item;
  });
}

// ---------------------------------------------------------------------------
// Custom object helpers
// ---------------------------------------------------------------------------

/**
 * Discover all custom_objects.* schema keys for the location.
 * One API call, shared across all lookups.
 */
async function discoverCustomObjectSchemaKeys(params: {
  apiKey: string;
  locationId: string;
}): Promise<string[]> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/objects/?locationId=${encodeURIComponent(params.locationId)}`,
    { headers: ghlHeaders(params.apiKey) }
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { objects?: AnyRecord[] };
  return (json.objects ?? [])
    .map((o) => String(o.key ?? ""))
    .filter((k) => k.startsWith("custom_objects."));
}

/**
 * Fetch a custom object record by schema key + record ID.
 * Returns the record's top-level name and its properties object.
 */
async function fetchCustomObjectRecordById(params: {
  apiKey: string;
  schemaKey: string;
  recordId: string;
}): Promise<{ name: string; properties: AnyRecord }> {
  if (!params.recordId || !params.schemaKey) return { name: "", properties: {} };
  const res = await fetch(
    `https://services.leadconnectorhq.com/objects/${encodeURIComponent(
      params.schemaKey
    )}/records/${encodeURIComponent(params.recordId)}`,
    { headers: ghlHeaders(params.apiKey) }
  );
  if (!res.ok) return { name: "", properties: {} };
  const json = (await res.json()) as AnyRecord;
  const record = asRecord(json.record) ?? asRecord(json.data) ?? asRecord(json) ?? {};
  return {
    name: String(record.name ?? ""),
    properties: asRecord(record.properties) ?? {}
  };
}

// ---------------------------------------------------------------------------
// Program Offer lookup helpers
// ---------------------------------------------------------------------------

function pickNameFromProperties(properties: AnyRecord): string {
  const preferredKeys = ["program_offer", "program", "application", "product", "name"];
  for (const key of preferredKeys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(properties)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Search all custom object records by relation to find the one linked to the
 * given opportunity. Returns the record's display name, its GHL record ID,
 * and its xero_tracking_code property (if Automation 6 has set it).
 */
async function findProgramOfferByRelation(params: {
  apiKey: string;
  locationId: string;
  opportunityId: string;
  schemaKeys: string[];
}): Promise<{ name: string; id: string; programOfferCode: string }> {
  const headers = ghlHeaders(params.apiKey);

  // Prioritise keys that look like program offer / product objects
  const prioritizedKeys = [
    ...params.schemaKeys.filter(
      (k) => k.includes("programoffer") || k.includes("program_offer")
    ),
    ...params.schemaKeys.filter((k) => k.includes("products")),
    ...params.schemaKeys
  ].filter((k, i, arr) => arr.indexOf(k) === i);

  for (const schemaKey of prioritizedKeys) {
    for (let page = 1; page <= 5; page += 1) {
      const res = await fetch(
        `https://services.leadconnectorhq.com/objects/${encodeURIComponent(
          schemaKey
        )}/records/search`,
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
      if (!res.ok) break;

      const json = (await res.json()) as { records?: AnyRecord[] };
      const matched = json.records?.find((record) => {
        const relations = Array.isArray(record.relations) ? record.relations : [];
        return relations.some((rel) => {
          const r = asRecord(rel);
          return (
            String(r?.objectKey ?? "").toLowerCase() === "opportunity" &&
            String(r?.recordId ?? "") === params.opportunityId
          );
        });
      });

      if (matched) {
        const properties = asRecord(matched.properties) ?? {};
        const name =
          String(matched.name ?? "").trim() || pickNameFromProperties(properties);
        const id = String(matched.id ?? matched._id ?? "");
        const programOfferCode = String(properties.xero_tracking_code ?? "").trim();
        return { name, id, programOfferCode };
      }
    }
  }

  return { name: "", id: "", programOfferCode: "" };
}

// ---------------------------------------------------------------------------
// Full GHL context — used by the opportunity-context route
// ---------------------------------------------------------------------------

export type GhlFullContext = {
  opportunityName: string;
  clientName: string;
  studentEmail: string;
  /** Program Offer display name */
  application: string;
  /** GHL record ID of the Program Offer custom object */
  programOfferId: string;
  xeroCustomerNumber: string;
  /**
   * Xero tracking code — sourced in priority order:
   *   1. opportunity.xero_tracking_code (if already set from a prior submission)
   *   2. Program Offer record's xero_tracking_code property (set by Automation 6)
   *   3. Computed fallback: {xeroCustomerNumber}_{programOfferId}
   */
  xeroTrackingCode: string;
};

export async function getFullGhlContext(params: {
  apiKey: string;
  locationId: string;
  oppId: string;
  contactId: string;
}): Promise<GhlFullContext> {
  const headers = ghlHeaders(params.apiKey);

  // ── 1. Fetch opportunity, contact, and field schema in parallel ───────
  const [oppRes, contactRes, fieldSchemaMap] = await Promise.all([
    fetch(`https://services.leadconnectorhq.com/opportunities/${params.oppId}`, { headers }),
    fetch(`https://services.leadconnectorhq.com/contacts/${params.contactId}`, { headers }),
    fetchFieldSchemaMap({ apiKey: params.apiKey, locationId: params.locationId })
  ]);

  const result: GhlFullContext = {
    opportunityName: "",
    clientName: "",
    studentEmail: "",
    application: "",
    programOfferId: "",
    xeroCustomerNumber: "",
    xeroTrackingCode: ""
  };

  let opportunity: AnyRecord = {};
  let enrichedContactCf: AnyRecord[] = [];
  let locationId = params.locationId;

  if (oppRes.ok) {
    const json = (await oppRes.json()) as AnyRecord;
    opportunity = asRecord(json.opportunity) ?? asRecord(json.data) ?? json;
    result.opportunityName = typeof opportunity.name === "string" ? opportunity.name : "";
    if (typeof opportunity.locationId === "string" && opportunity.locationId) {
      locationId = opportunity.locationId;
    }
  }

  if (contactRes.ok) {
    const json = (await contactRes.json()) as AnyRecord;
    const contact = asRecord(json.contact) ?? asRecord(json.data) ?? json;
    result.clientName = fullName(contact);
    result.studentEmail = typeof contact.email === "string" ? contact.email.trim() : "";
    // Enrich: GHL returns contact customFields as bare {id, value} — inject the key via schema
    enrichedContactCf = enrichCustomFields(contact.customFields, fieldSchemaMap);
  }

  // ── 2. Read what we can directly from custom fields ───────────────────
  // Opportunity customFields may be null before any values are written; enrich just in case.
  const oppCf = enrichCustomFields(opportunity.customFields, fieldSchemaMap);

  // Xero Contact ID: on the opportunity (xero_contact_id) or the contact as fallback
  result.xeroCustomerNumber =
    getCustomFieldValue(oppCf, "xero_contact_id", "xerocontactid", "xero_contact") ||
    getCustomFieldValue(enrichedContactCf, "xero_contact_id", "xerocontactid", "xero_contact", "xero_customer_number", "xerocustomernumber");

  // Internal record ID for direct-fetch optimisation (may be UUID from a prior load)
  const programOfferRecordId = getCustomFieldValue(oppCf, "program_offer_id");

  // Priority 1: xero_tracking_code already written to opportunity (prior submit)
  result.xeroTrackingCode = getCustomFieldValue(oppCf, "xero_tracking_code");

  // Try to get application name directly from opportunity custom fields
  if (!result.application) {
    result.application = getCustomFieldValue(oppCf, "programoffer", "program_offer");
  }

  // ── 3. Discover custom object schema keys (one shared call) ───────────
  const schemaKeys = await discoverCustomObjectSchemaKeys({
    apiKey: params.apiKey,
    locationId
  });

  const programOfferSchemaKey = schemaKeys.find(
    (k) => k.includes("programoffer") || k.includes("program_offer")
  );

  // ── 4. Try direct fetch if we have an internal record ID ─────────────
  // programOfferRecordId may be a GHL UUID (fast path) or a short code (will fail gracefully)
  let programOfferResolved = false;
  if (programOfferRecordId && programOfferSchemaKey) {
    const { name, properties } = await fetchCustomObjectRecordById({
      apiKey: params.apiKey,
      schemaKey: programOfferSchemaKey,
      recordId: programOfferRecordId
    });

    // programOfferCode = short code like TRIN-DBCM from Automation 6
    const programOfferCode = String(properties.xero_tracking_code ?? "").trim();
    if (programOfferCode || name) {
      programOfferResolved = true;
      if (!result.application) {
        result.application = name || pickNameFromProperties(properties);
      }
      // programOfferId exposed to the UI = short code (e.g. TRIN-DBCM), not the GHL UUID
      result.programOfferId = programOfferCode;
      if (!result.xeroTrackingCode && result.xeroCustomerNumber && programOfferCode) {
        result.xeroTrackingCode = `${result.xeroCustomerNumber}-${programOfferCode}`;
      }
    }
  }

  // ── 5. Relation search fallback (runs when direct fetch found nothing) ─
  if (!programOfferResolved) {
    const found = await findProgramOfferByRelation({
      apiKey: params.apiKey,
      locationId,
      opportunityId: params.oppId,
      schemaKeys
    });

    if (!result.application) result.application = found.name;
    // programOfferId = short code (e.g. TRIN-DBCM)
    result.programOfferId = found.programOfferCode;
    if (!result.xeroTrackingCode && result.xeroCustomerNumber && found.programOfferCode) {
      result.xeroTrackingCode = `${result.xeroCustomerNumber}-${found.programOfferCode}`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// PDF context — lightweight version used by PDF routes
// ---------------------------------------------------------------------------

export async function getPdfContext(params: {
  apiKey: string;
  oppId: string;
  contactId: string;
}): Promise<PaymentPlanPdfContext> {
  const locationId = getEnv("GHL_LOCATION_ID", "GHL_sub-account_Location");
  if (locationId) {
    try {
      const ctx = await getFullGhlContext({
        apiKey: params.apiKey,
        locationId,
        oppId: params.oppId,
        contactId: params.contactId
      });
      return {
        studentName: ctx.clientName,
        studentEmail: ctx.studentEmail,
        application: ctx.application
      };
    } catch {
      // fall through to lightweight fetch below
    }
  }

  // Lightweight fallback: no object lookups
  const headers = ghlHeaders(params.apiKey);
  const [oppRes, contactRes] = await Promise.all([
    fetch(`https://services.leadconnectorhq.com/opportunities/${params.oppId}`, { headers }),
    fetch(`https://services.leadconnectorhq.com/contacts/${params.contactId}`, { headers })
  ]);

  const context: PaymentPlanPdfContext = {};

  if (oppRes.ok) {
    const json = (await oppRes.json()) as AnyRecord;
    const opp = asRecord(json.opportunity) ?? asRecord(json.data) ?? json;
    const cf = Array.isArray(opp.customFields) ? opp.customFields : [];
    for (const field of cf) {
      const item = asRecord(field);
      if (!item) continue;
      const key = String(item.key ?? item.fieldKey ?? "").toLowerCase();
      if (key.includes("programoffer") || key.includes("program_offer")) {
        const val = item.field_value ?? item.value ?? item.fieldValue;
        if (typeof val === "string" && val.trim()) {
          context.application = val.trim();
          break;
        }
      }
    }
  }

  if (contactRes.ok) {
    const json = (await contactRes.json()) as AnyRecord;
    const contact = asRecord(json.contact) ?? asRecord(json.data) ?? json;
    context.studentName = fullName(contact);
    context.studentEmail = typeof contact.email === "string" ? contact.email : "";
  }

  return context;
}

// ---------------------------------------------------------------------------
// Contact email helper
// ---------------------------------------------------------------------------

export async function getContactEmail(params: {
  apiKey: string;
  contactId: string;
}): Promise<string> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(params.contactId)}`,
    { headers: ghlHeaders(params.apiKey) }
  );
  if (!res.ok) return "";
  const data = (await res.json()) as { contact?: { email?: string }; email?: string };
  return data.contact?.email || data.email || "";
}
