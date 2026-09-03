/* HttpN8nBridge — how Tom's n8n workflows become Unc's skills (docs/N8N-ROUTINES.md).

   The engine hands a produce step to the bridge when an active n8n_workflows row exists for
   the routine (account row first, then global), or when a spec carries an explicit n8n node.
   The bridge POSTs the signed run payload and reads the reply:

     200 { artifact: {...} }   → validated (kind / title / body / items / banned phrases) and
                                 stored by the engine like a producer's artifact
     200 { needs: [...] }      → the run ends waiting_input with the workflow's ask
     202                       → accepted; the workflow POSTs /api/routines/artifacts later
     anything else             → throws; the engine fails the run closed with a receipt

   Signature: x-unc-signature = "sha256=" HMAC-SHA256(N8N_SIGNING_SECRET, `${ts}.${body}`),
   x-unc-timestamp = ts (ms). The same scheme verifies the callback. */

import { compactReads } from "../../lib/artifacts/material";
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../../lib/artifacts/signing";
import { isArtifactKind, validateArtifactObject } from "../../lib/artifacts/validate";
import { DATA_ENDPOINTS, dataBaseUrl, issueDataToken, scopesForRoutine } from "../../lib/n8n/dataToken";
import { checkWebhookTarget, type HostLookup } from "../../lib/n8n/urlSecurity";
import { SKILL_BY_ID } from "../../lib/runtime/skills";
import type { N8nBridge, N8nCallResult, N8nNode, N8nWorkflow, ProduceNeed, ProduceNode, RunContext } from "../../lib/runtime/types";
import type { Logger } from "../log";
import { pinnedWebhookFetch, type WebhookFetch, type WebhookResponse } from "./pinnedWebhookFetch";

export const N8N_DEFAULT_TIMEOUT_MS = 60_000;
export const N8N_SECRET_ENV = "N8N_SIGNING_SECRET";

export interface N8nPayload {
  accountId: string;
  runId: string;
  routineId: string;
  skill: string;
  kind: string;
  mode: string;
  startedAt: string;
  account: { currency: string; budgetMonthly: number };
  inputs: Record<string, string>;
  vars: Record<string, unknown>;
  reads: ReturnType<typeof compactReads>;
  /** Where an async workflow posts the artifact, with the same HMAC scheme. */
  callback: { path: string; signatureHeader: string; timestampHeader: string };
  /** Run-scoped bearer token for /api/n8n/reads, /context, /actions (src/lib/n8n/dataToken.ts);
      null when the bridge was built without a secret (tests) — the workflow then has no data access. */
  dataToken: string | null;
  /** Base URL the token is good against (N8N_DATA_BASE_URL / APP_URL); null = unknown to the app. */
  dataBaseUrl: string | null;
  data: { scopes: string[]; expiresAt: string | null; endpoints: typeof DATA_ENDPOINTS };
}

export interface PayloadOptions {
  /** Signing secret; when present a data token is minted for the run. */
  secret?: string | null;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

export function buildN8nPayload(node: ProduceNode | N8nNode, ctx: RunContext, opts: PayloadOptions = {}): N8nPayload {
  const skillId = node.kind === "produce" ? (node.skill ?? ctx.routineId) : ctx.routineId;
  const scopes = scopesForRoutine(ctx.routineId);
  const minted = opts.secret ? issueDataToken(opts.secret, { accountId: ctx.account.accountId, runId: ctx.runId, routineId: ctx.routineId, scopes }, { now: opts.now }) : null;
  return {
    accountId: ctx.account.accountId,
    runId: ctx.runId,
    routineId: ctx.routineId,
    skill: skillId,
    kind: SKILL_BY_ID[skillId]?.kind ?? "generic",
    mode: ctx.mode,
    startedAt: ctx.startedAt,
    account: { currency: ctx.account.currency, budgetMonthly: ctx.account.budgetMonthly },
    inputs: ctx.inputs ?? {},
    vars: ctx.vars,
    reads: compactReads(ctx.reads),
    callback: { path: "/api/routines/artifacts", signatureHeader: SIGNATURE_HEADER, timestampHeader: TIMESTAMP_HEADER },
    dataToken: minted?.token ?? null,
    dataBaseUrl: dataBaseUrl(opts.env ?? {}),
    data: { scopes, expiresAt: minted ? new Date(minted.claims.exp).toISOString() : null, endpoints: DATA_ENDPOINTS },
  };
}

/** Parse a workflow's reply body into a call result (shared with the callback route). */
export function parseN8nReply(parsed: unknown, expectedKind: string, maxItems?: number): N8nCallResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("n8n reply is not a JSON object");
  const o = parsed as { artifact?: unknown; needs?: unknown };
  if (Array.isArray(o.needs)) {
    const needs: ProduceNeed[] = o.needs
      .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
      .map((n) => ({ ...(typeof n.platform === "string" ? { platform: n.platform as ProduceNeed["platform"] } : {}), ...(typeof n.input === "string" ? { input: n.input.slice(0, 64) } : {}), why: typeof n.why === "string" ? n.why.slice(0, 400) : "the workflow needs more" }))
      .slice(0, 10);
    if (!needs.length) throw new Error("n8n reply has an empty needs list");
    return { kind: "needs", needs };
  }
  if (o.artifact && typeof o.artifact === "object") {
    const a = o.artifact as { kind?: unknown };
    const kind = isArtifactKind(a.kind) ? a.kind : isArtifactKind(expectedKind) ? expectedKind : "generic";
    const v = validateArtifactObject({ ...a, kind }, { kind, maxItems, allowedNumbers: null });
    if (!v.ok) throw new Error(`n8n artifact rejected: ${v.reason}`);
    return { kind: "artifact", artifact: v.artifact };
  }
  throw new Error("n8n reply carries neither artifact nor needs");
}

export interface HttpN8nBridgeOptions {
  env?: Record<string, string | undefined>;
  /** Injectable transport for tests; production defaults to the DNS-pinned Node transport. */
  fetch?: WebhookFetch;
  now?: () => Date;
  log?: Logger;
  timeoutMs?: number;
  /** Test seam for request-time DNS validation. */
  lookup?: HostLookup;
}

export class HttpN8nBridge implements N8nBridge {
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;
  constructor(private readonly opts: HttpN8nBridgeOptions = {}) {
    this.env = opts.env ?? process.env;
    this.now = opts.now ?? (() => new Date());
  }

  private resolveUrl(node: ProduceNode | N8nNode, workflow: N8nWorkflow | null): string | null {
    if (node.kind === "n8n") {
      if (node.webhookUrl) return node.webhookUrl;
      if (node.webhookUrlEnv) return (this.env[node.webhookUrlEnv] ?? "").trim() || null;
    }
    return workflow?.webhookUrl ?? null;
  }

  async call(node: ProduceNode | N8nNode, ctx: RunContext, workflow: N8nWorkflow | null): Promise<N8nCallResult> {
    const url = this.resolveUrl(node, workflow);
    if (!url) throw new Error("no n8n webhook is registered for this routine");
    const target = await checkWebhookTarget(url, this.env, { maxLength: 2000, lookup: this.opts.lookup });
    if (!target.ok) throw new Error(`n8n webhook refused: ${target.reason}`);
    const secret = (this.env[N8N_SECRET_ENV] ?? "").trim();
    if (!secret) throw new Error(`${N8N_SECRET_ENV} is not set — refusing to call n8n unsigned`);
    const payload = buildN8nPayload(node, ctx, { secret, env: this.env, now: this.now });
    const body = JSON.stringify(payload);
    const ts = String(this.now().getTime());
    const f = this.opts.fetch ?? pinnedWebhookFetch;
    const timeoutMs = node.kind === "n8n" && node.timeoutMs ? node.timeoutMs : (this.opts.timeoutMs ?? N8N_DEFAULT_TIMEOUT_MS);
    let res: WebhookResponse;
    try {
      res = await f(target.url.toString(), { method: "POST", redirect: "manual", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(secret, body, ts), [TIMESTAMP_HEADER]: ts }, body, signal: AbortSignal.timeout(timeoutMs) }, target.pin);
    } catch (err) {
      this.opts.log?.warn("n8n.call_failed", { runId: ctx.runId, routineId: ctx.routineId, error: err instanceof Error ? err.name : "unknown" });
      throw new Error(`n8n webhook unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    if (res.status >= 300 && res.status < 400) throw new Error(`n8n webhook redirect refused (${res.status})`);
    if (res.status === 202) {
      this.opts.log?.info("n8n.accepted", { runId: ctx.runId, routineId: ctx.routineId });
      return { kind: "accepted" };
    }
    if (!res.ok) throw new Error(`n8n webhook answered ${res.status}`);
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new Error("n8n webhook answered with a body that is not JSON");
    }
    const out = parseN8nReply(parsed, payload.kind, node.kind === "produce" ? node.maxItems : undefined);
    this.opts.log?.info("n8n.replied", { runId: ctx.runId, routineId: ctx.routineId, kind: out.kind });
    return out;
  }
}
