import { NextRequest, NextResponse } from "next/server";

type AnyRecord = Record<string, unknown>;

function getEnv(...keys: string[]): string {
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

  // Discover the ProgramOffer custom object key dynamically for this location.
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

  // Search newest records first and match by opportunity relation.
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

function fullName(contact: AnyRecord): string {
  const first = typeof contact.firstName === "string" ? contact.firstName.trim() : "";
  const last = typeof contact.lastName === "string" ? contact.lastName.trim() : "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const direct = typeof contact.name === "string" ? contact.name.trim() : "";
  return direct;
}

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

    const headers: HeadersInit = {
      Authorization: `Bearer ${ghlApiKey}`,
      Version: "2021-07-28",
      "Content-Type": "application/json"
    };

    const [opportunityRes, contactRes] = await Promise.all([
      fetch(`https://services.leadconnectorhq.com/opportunities/${oppId}`, { headers }),
      fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, { headers })
    ]);

    if (!opportunityRes.ok) {
      const message = await opportunityRes.text();
      throw new Error(`Failed opportunity lookup: ${opportunityRes.status} ${message}`);
    }

    if (!contactRes.ok) {
      const message = await contactRes.text();
      throw new Error(`Failed contact lookup: ${contactRes.status} ${message}`);
    }

    const opportunityJson = (await opportunityRes.json()) as AnyRecord;
    const contactJson = (await contactRes.json()) as AnyRecord;

    const opportunity =
      asRecord(opportunityJson.opportunity) || asRecord(opportunityJson.data) || opportunityJson;
    const contact = asRecord(contactJson.contact) || asRecord(contactJson.data) || contactJson;

    const directApplication = findProgramOffer(opportunity);
    const associatedApplication =
      directApplication ||
      (await findProgramOfferFromAssociatedObject({
        apiKey: ghlApiKey,
        locationId: String(opportunity.locationId ?? getEnv("GHL_sub-account_Location", "GHL_LOCATION_ID")),
        opportunityId: oppId
      }));

    return NextResponse.json({
      opportunityName: typeof opportunity.name === "string" ? opportunity.name : "",
      clientName: fullName(contact),
      application: associatedApplication
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
