import { stableHash } from "../runtime/context";
import { validateSpec } from "../runtime/validate";
import { assertProxyRuntimeContext, authenticate, type ProxyDeps } from "./proxy";
import { RuntimeContextError, runtimeGeneration } from "../runtime/contextFence";
import { assertProtocolRequest, isCalendarShadow, projectProtocolContract } from "./shadowProtocols";
import { CALENDAR_SHADOW_RECEIVER_URL } from "./calendarShadowContract";
import { DbShadowAdmission, shadowTokenDigest } from "./shadowAdmission";
import { bearerToken } from "./dataToken";

/** Consumes one existing run-bound provider allowance; never creates an allowance.
 * GET is retained for the frozen receiver contract. It is no-store, authenticated and
 * deliberately non-repeatable. A lost response must be reconciled, not replayed.
 * The receiver must use the canonical client returned here, never webhook body overrides.
 * Call only an independently pinned Junction origin, with redirects disabled.
 */
export async function shadowAuthority(deps: ProxyDeps, req: Request, receiverUrl: string | undefined): Promise<Response> {
  return protocolAuthority(deps, req, receiverUrl, false);
}
/** Separate entry point; no calendar allowance is inferred from a keyword ledger. */
export async function calendarShadowAuthority(deps: ProxyDeps, req: Request, receiverUrl: string | undefined): Promise<Response> {
  if (req.method !== "POST") return Response.json({ ok: false, error: "calendar authority requires POST" },
    { status: 405, headers: { "allow": "POST", "cache-control": "no-store", "vary": "Authorization" } });
  return protocolAuthority(deps, req, receiverUrl, true);
}
async function protocolAuthority(deps: ProxyDeps, req: Request, receiverUrl: string | undefined, calendar: boolean): Promise<Response> {
  const headers = { "cache-control": "no-store", "vary": "Authorization" };
  const deny = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers });
  const auth = await authenticate(deps, req);
  if (!auth.ok) return deny(auth.status, auth.error);
  const { run, spec, claims } = auth;
  // Version alone does not guard against a draft edited in place while a run is open.
  if (!run.specHash || run.specHash !== stableHash(spec)) return deny(409, "stored shadow specification changed or has no fingerprint");
  if (validateSpec(spec).length) return deny(403, "invalid shadow specification");
  const producers = spec.nodes.filter(node => node.kind === "n8n" || node.kind === "produce");
  const node = producers[0];
  if (producers.length !== 1 || node?.kind !== "n8n" || !node.shadowContract ||
      spec.nodes.some(node => node.kind === "execute") ||
      !spec.nodes.some(node => node.kind === "trigger" && node.cadence === "manual")) {
    return deny(403, "run is not an explicit manual keyword shadow routine");
  }
  const contract = node.shadowContract;
  if (isCalendarShadow(contract) !== calendar) return deny(403, "shadow authority protocol mismatch");
  if (calendar && (receiverUrl !== CALENDAR_SHADOW_RECEIVER_URL || run.snapshot?.awaiting !== "calendar_shadow"))
    return deny(403, "calendar receiver or dispatch continuation is not pinned");
  try {
    assertProtocolRequest(contract, { accountId: run.accountId, runId: run.id, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt });
  } catch {
    return deny(403, "shadow account, routine or dry-run authority does not match");
  }
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(started) || started > now.getTime() + 30_000 || now.getTime() - started > 15 * 60_000) {
    return deny(409, "shadow run is stale or has invalid timing");
  }
  const registration = await deps.store.findN8nWorkflow(run.accountId, run.routineId);
  if (!registration?.active || registration.accountId !== run.accountId || registration.routineId !== run.routineId) {
    return deny(403, "shadow run has no active account-specific receiver registration");
  }
  // A revoked/moved registration must not be authorized just because its old token is fresh.
  try {
    const pin = new URL(receiverUrl ?? "");
    if (pin.protocol !== "https:" || pin.username || pin.password || pin.hash ||
        new URL(registration.webhookUrl).href !== pin.href) return deny(503, "shadow receiver is not pinned");
  } catch {
    return deny(503, "shadow receiver is not pinned");
  }
  // Explicit projection avoids disclosing arbitrary snapshot fields, secrets, reads or context.
  const shadow = projectProtocolContract(contract);
  try {
    await assertProxyRuntimeContext(deps, run);
  } catch (error) {
    return deny(error instanceof RuntimeContextError && error.code === "context_changed" ? 409 : 503,
      "The stored run's business context is stale, paused or unavailable");
  }
  const admission = calendar ? deps.calendarShadowAdmission : deps.shadowAdmission ?? (deps.db ? new DbShadowAdmission(deps.db) : undefined);
  if (!admission) return deny(503, "Durable shadow admission is unavailable");
  try {
    const allowed = await admission.authorize({ accountId: run.accountId, contextGeneration: runtimeGeneration(run.contextGeneration),
      runId: run.id, registrationId: registration.id, contract, specHash: run.specHash,
      tokenDigest: shadowTokenDigest(bearerToken(req.headers.get("authorization"))!) });
    if (!allowed) return deny(409, "No unused shadow provider allowance; reconcile the existing dispatch");
  } catch {
    return deny(503, "Shadow allowance could not be confirmed; do not call the provider");
  }
  return Response.json({ ok: true, shadow,
    run: { id: run.id, accountId: run.accountId, routineId: run.routineId, mode: run.mode, status: run.status, startedAt: run.startedAt },
    authorizedAt: now.toISOString(), expiresAt: new Date(claims.exp).toISOString(),
    // workflowVersion is the EXPECTED server pin; it is not proof of what n8n executed.
    revisionEvidence: "expected_only", executedAction: "none",
  }, { headers });
}
