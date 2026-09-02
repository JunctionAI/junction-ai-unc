/* GET /api/llm/ping?model=<catalogue id | provider:model> — DEV ONLY smoke test.

   → { provider, model, ok, latencyMs, stopReason, usage, text?, error? }
   Disabled in production (404). A 401/403 means the provider key is wrong, a 404 means the
   model id is wrong — say so rather than guessing. Writes a "ping" row to llm_usage. */

import { completeModel, parseModelId } from "@/lib/llm/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const model = (url.searchParams.get("model") ?? "").trim();
  if (!parseModelId(model)) return Response.json({ error: `unknown model id "${model.slice(0, 80)}"` }, { status: 400 });
  const result = await completeModel(model, { system: "You are a health check. Reply with exactly: pong", messages: [{ role: "user", content: "ping" }], maxTokens: 64, effort: "low" }, { accountId: null });
  if (!result) return Response.json({ error: "unresolvable" }, { status: 400 });
  const ok = result.stopReason !== "error";
  return Response.json({ provider: result.provider, model: result.model, ok, latencyMs: result.latencyMs, stopReason: result.stopReason, usage: result.usage, text: ok ? result.text.slice(0, 200) : undefined, error: ok ? undefined : { code: result.errorCode, message: result.errorMessage } });
}
