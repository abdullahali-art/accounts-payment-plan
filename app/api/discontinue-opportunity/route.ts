import { NextResponse } from "next/server";
import { getEnv } from "@/lib/ghl-context";

const GHL_VERSION = "2021-07-28";

function ghlHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json"
  };
}

async function findDiscontinuedStageId(params: {
  apiKey: string;
  locationId: string;
  pipelineId: string;
}): Promise<string> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(params.locationId)}`,
    { headers: ghlHeaders(params.apiKey) }
  );
  if (!res.ok) throw new Error(`Failed to fetch pipelines: ${res.status}`);

  const json = (await res.json()) as { pipelines?: Array<{ id: string; stages?: Array<{ id: string; name: string }> }> };
  const pipeline = json.pipelines?.find((p) => p.id === params.pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${params.pipelineId} not found.`);

  const stage = pipeline.stages?.find((s) => s.name.toLowerCase().includes("discontinu"));
  if (!stage) throw new Error('No stage matching "Discontinued" found in pipeline.');

  return stage.id;
}

export async function POST(request: Request) {
  try {
    const { opp_id } = (await request.json()) as { opp_id?: string };
    if (!opp_id) return NextResponse.json({ error: "opp_id is required." }, { status: 400 });

    const apiKey = getEnv("GHL_API_KEY");
    const locationId = getEnv("GHL_LOCATION_ID", "GHL_sub-account_Location");
    if (!apiKey) throw new Error("Missing GHL_API_KEY.");
    if (!locationId) throw new Error("Missing GHL_LOCATION_ID.");

    // Fetch current opportunity
    const oppRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/${opp_id}`,
      { headers: ghlHeaders(apiKey) }
    );
    if (!oppRes.ok) throw new Error(`Failed to fetch opportunity: ${oppRes.status}`);
    const oppJson = (await oppRes.json()) as { opportunity?: Record<string, unknown> };
    const opp = oppJson.opportunity ?? {};

    const pipelineId = String(opp.pipelineId ?? opp.pipeline_id ?? "wV69klqYpAvY1OY9E6HX");

    // Find the Discontinued stage
    const stageId = await findDiscontinuedStageId({ apiKey, locationId, pipelineId });

    // Move opportunity to Discontinued stage
    const putRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/${opp_id}`,
      {
        method: "PUT",
        headers: ghlHeaders(apiKey),
        body: JSON.stringify({
          name: opp.name ?? "",
          status: opp.status ?? "open",
          monetaryValue: typeof opp.monetaryValue === "number" ? opp.monetaryValue : 0,
          contactId: opp.contactId ?? "",
          pipelineId,
          pipelineStageId: stageId
        })
      }
    );
    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`Failed to update opportunity: ${putRes.status} ${text}`);
    }

    return NextResponse.json({ message: "Opportunity moved to Discontinued." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 }
    );
  }
}
