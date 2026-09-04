/* GET/POST /api/settings/models — the founder's per-task model choice (session-bound).

   GET  → { prefs: { <task>: modelId }, resolved: { <task>: { id, provider, tier, source, fallbackFrom? } },
            catalogue: [...], configured: { anthropic, openai, gemini, openrouter, custom } }
   POST { task, modelId | null } → { ok: true, resolved: {...} }   (null = back to the default)
   or   { fallback: true }   demo mode (no database) — the UI hides the section
   or   401 | 403 | 503 { error }

   Writes go through the founder's own client (member RLS on account_model_prefs). */

import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { isLlmTask, listModelPrefs, writeModelPref } from "@/lib/llm/prefs";
import { CATALOGUE, isProviderConfigured, resolveModel } from "@/lib/llm/router";
import { LLM_TASKS, PROVIDER_IDS, type LlmTask, type ProviderId, type ResolvedModel } from "@/lib/llm/types";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const summary = (r: ResolvedModel | null) => (r ? { id: r.id, provider: r.provider, model: r.model, tier: r.tier, source: r.source, fallbackFrom: r.fallbackFrom ?? null } : null);

function resolvedFor(prefs: Partial<Record<LlmTask, string>>) {
  return Object.fromEntries(LLM_TASKS.map((t) => [t, summary(resolveModel(t, { accountOverride: prefs[t] ?? null }))])) as Record<LlmTask, ReturnType<typeof summary>>;
}

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const prefs = await listModelPrefs(session.db, session.accountId);
    const configured = Object.fromEntries(PROVIDER_IDS.map((p) => [p, isProviderConfigured(p)])) as Record<ProviderId, boolean>;
    return Response.json({ prefs, resolved: resolvedFor(prefs), catalogue: CATALOGUE, configured });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "settings lookup failed" }, { status: 500 });
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  let body: { task?: unknown; modelId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isLlmTask(body.task)) return Response.json({ error: "unknown task" }, { status: 400 });
  const modelId = body.modelId === null || body.modelId === undefined || body.modelId === "" ? null : typeof body.modelId === "string" ? body.modelId.trim().slice(0, 240) : undefined;
  // Account UI choices are maintained catalogue entries. `custom` is explicitly the
  // operator-trusted self-hosted entry; every hosted entry has maintained pricing. Operators
  // may still use an ad-hoc provider:model through env, but an account cannot persist an
  // unpriced hosted model that would evade its dollar cap.
  if (modelId === undefined || (modelId !== null && !CATALOGUE.some((entry) => entry.id === modelId))) return Response.json({ error: "unknown or unpriced model id" }, { status: 400 });
  try {
    await writeModelPref(session.service, session.accountId, body.task, modelId);
    const prefs = await listModelPrefs(session.service, session.accountId);
    return Response.json({ ok: true, prefs, resolved: resolvedFor(prefs) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "settings write failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/settings/models", handleGET);
export const POST = withErrorCapture("api/settings/models", handlePOST);
