import { z } from "zod";
import { requireOpsIdentity } from "@/lib/ops/session";
import { sourceBindingSchema } from "@/lib/ops/sourceBindings";
import { readMissionControlEmailCampaigns } from "@/lib/sources/missionControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers:{ "cache-control":"private, no-store" } });
const inputSchema = z.object({ accountId:z.string().uuid(), contextGeneration:z.number().int().nonnegative(), bindingId:z.string().uuid() }).strict();

export async function POST(req: Request) {
  try {
    const operator = await requireOpsIdentity();
    if (operator instanceof Response) { operator.headers.set("cache-control","private, no-store"); return operator; }
    if (new URL(req.url).search) return json({ error:"Unexpected source parameters." },400);
    const origin=req.headers.get("origin");
    if ((origin && origin!==new URL(req.url).origin) || req.headers.get("sec-fetch-site")==="cross-site") return json({ error:"Same-origin source verification required." },403);
    if (req.headers.get("content-type")?.split(";")[0].trim()!=="application/json") return json({ error:"JSON required." },415);
    const raw=await req.text(); if(raw.length>1024) return json({ error:"Source verification request too large." },413);
    const parsed=inputSchema.safeParse(JSON.parse(raw)); if(!parsed.success) return json({ error:"Exact client source selection required." },400);
    const result=await operator.service.rpc("authorize_ops_account_source_read",{p_user_id:operator.userId,p_account_id:parsed.data.accountId.toLowerCase(),p_context_generation:parsed.data.contextGeneration,p_binding_id:parsed.data.bindingId.toLowerCase()});
    if(result.error?.code==="42501") return json({ error:"Source-read authority is required for this client." },403);
    if(result.error?.code==="PT409") return json({ error:"Client or source identity changed. Refresh before reading." },409);
    const binding=sourceBindingSchema.safeParse(result.data);
    if(result.error||!binding.success||binding.data.accountId!==parsed.data.accountId.toLowerCase()||binding.data.id!==parsed.data.bindingId.toLowerCase()||binding.data.sourceSystem!=="mission_control") return json({ error:"Source identity could not be authorized." },503);
    const read=await readMissionControlEmailCampaigns({accountId:binding.data.accountId,sourceProject:binding.data.sourceProject,sourceKind:binding.data.sourceKind,sourceKey:binding.data.sourceKey,limit:1});
    return json({ accountId:read.accountId,bindingId:binding.data.id,contract:read.contract,dataset:read.dataset,sourceRowCount:read.sourceRowCount,sourceMaxUpdatedAt:read.sourceMaxUpdatedAt,bridgeFetchedAt:read.bridgeFetchedAt,bridgeDeploymentId:read.bridgeDeploymentId });
  } catch(error) {
    if(error instanceof SyntaxError) return json({ error:"Invalid source verification JSON." },400);
    return json({ error:"Fresh source read could not be verified." },503);
  }
}
