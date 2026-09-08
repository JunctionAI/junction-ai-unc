import { asDb } from "@/lib/db/client";
import { getServiceSupabase } from "@/lib/db/server";
import { receiveGrokAuthority } from "@/lib/agents/grokControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ changeId: string }> }) {
  return receiveGrokAuthority(request, (await context.params).changeId, {
    db: () => asDb(getServiceSupabase()),
    secret: process.env.JUNCTION_GROK_CONTROL_SECRET ?? "",
    enabled: process.env.JUNCTION_GROK_CONTROL_ENABLED === "true",
  });
}
