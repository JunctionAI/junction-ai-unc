/* POST /api/routines/artifacts — an n8n workflow delivers the artifact for a run it accepted.

   Headers: x-unc-signature: sha256=HMAC(N8N_SIGNING_SECRET, `${x-unc-timestamp}.${raw body}`),
            x-unc-timestamp: ms since epoch (±5 min)
   Body:    { runId, artifact: { kind, title, body, items?, meta?, evidence? } }
         or { runId, needs: [{ platform? | input?, why }] }
   →       { run: { runId, status, summary, receipts[], artifact? } }
   or      400 { error } | 401 (bad signature) | 404 (unknown run) | 409 (run not waiting for n8n)
           | 503 (no N8N_SIGNING_SECRET)

   No session: the signature is the auth. The run must be one the engine handed to n8n
   (snapshot.awaiting = "n8n"), so a signed caller can only finish its own runs. */

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "@/lib/artifacts/signing";
import { getStore } from "@/lib/runtime/store";
import { parseN8nReply, N8N_SECRET_ENV } from "@/worker/providers/n8n";
import { completeExternal, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun } from "../shared";
import { withErrorCapture } from "@/lib/observability/errors";
import { SKILL_BY_ID } from "@/lib/runtime/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: defaultAccountsSource() };
}

async function handlePOST(req: Request) {
  const secret = (process.env[N8N_SECRET_ENV] ?? "").trim();
  if (!secret) return Response.json({ error: `${N8N_SECRET_ENV} is not configured` }, { status: 503 });
  const raw = await req.text();
  const v = verify(secret, raw, req.headers.get(TIMESTAMP_HEADER), req.headers.get(SIGNATURE_HEADER));
  if (!v.ok) return Response.json({ error: `signature ${v.reason}` }, { status: 401 });

  let body: { runId?: unknown; artifact?: unknown; needs?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim().slice(0, 128) : "";
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
  const store = getStore();
  const run = await store.getRun(runId);
  if (!run) return Response.json({ error: `run ${runId} not found` }, { status: 404 });
  if (run.status !== "running" || run.snapshot?.awaiting !== "n8n") return Response.json({ error: `run ${runId} is not waiting for an n8n artifact` }, { status: 409 });

  const node = run.snapshot.spec.nodes[run.snapshot.nextNodeIndex - 1];
  if (node?.kind === "n8n" && node.shadowContract) return Response.json({ error: "shadow integrations require synchronous completion with execution evidence" }, { status: 409 });
  const skillId = node?.kind === "produce" ? (node.skill ?? run.routineId) : run.routineId;
  const expectedKind = SKILL_BY_ID[skillId]?.kind ?? "generic";
  let parsed;
  try {
    parsed = parseN8nReply(body, expectedKind, node?.kind === "produce" ? node.maxItems : SKILL_BY_ID[skillId]?.maxItems);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "invalid artifact" }, { status: 400 });
  }
  if (parsed.kind === "accepted") return Response.json({ error: "the callback must carry an artifact or needs" }, { status: 400 });
  try {
    const result = await completeExternal(deps(), parsed.kind === "artifact" ? { runId, artifact: parsed.artifact } : { runId, needs: parsed.needs });
    return Response.json({ run: summariseRun(result) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "completion failed";
    if (/not found/.test(message)) return Response.json({ error: message }, { status: 404 });
    if (/not waiting/.test(message)) return Response.json({ error: message }, { status: 409 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/artifacts", handlePOST);
