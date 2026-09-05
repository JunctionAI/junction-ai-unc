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
import { assertShadowRequest, validateShadowReceipt, verifyShadowExecution, type KeywordShadowContract } from "../../lib/n8n/shadowContract";
import type { N8nBridge, N8nCallResult, N8nNode, N8nWorkflow, ProduceNeed, ProduceNode, RunContext } from "../../lib/runtime/types";
import type { Logger } from "../log";
import { pinnedWebhookFetch, type WebhookFetch, type WebhookResponse } from "./pinnedWebhookFetch";
import { createShadowExecutionReader, type ShadowExecutionReader } from "./n8nExecutionReader";
import { shadowRequestDigest } from "../../lib/n8n/executionEvidence";
import { shadowTokenDigest, type ShadowAdmission } from "../../lib/n8n/shadowAdmission";
import { runtimeGeneration } from "../../lib/runtime/contextFence";
import { shadowCandidate, verifiedShadowResult } from "../../lib/n8n/shadowCandidate";

export const N8N_DEFAULT_TIMEOUT_MS = 60_000;
export const N8N_SECRET_ENV = "N8N_SIGNING_SECRET";

export interface N8nPayload {
  shadow?: KeywordShadowContract;
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
    ...(node.kind === "n8n" && node.shadowContract ? { shadow: node.shadowContract } : {}),
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
    const kind = isArtifactKind(expectedKind) ? expectedKind : "generic";
    const v = validateArtifactObject(a, { kind, maxItems, allowedNumbers: null });
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
  /** Server-owned independent execution reader. Must read the named execution's
   * saved revision + trigger identity, never current/latest workflow metadata.
   * Otherwise the separately gated/pinned public-API reader is used. */
  readShadowExecution?: ShadowExecutionReader;
  /** Separate test seam: the execution API key never goes through the webhook transport. */
  executionFetch?: WebhookFetch;
  /** Durable operator-issued permit; required for every paid shadow dispatch. */
  shadowAdmission?: ShadowAdmission;
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
    const shadow = node.kind === "n8n" ? node.shadowContract : undefined;
    const identity = { accountId: ctx.account.accountId, runId: ctx.runId, routineId: ctx.routineId, mode: ctx.mode, startedAt: ctx.startedAt };
    if (shadow) {
      assertShadowRequest(shadow, identity);
      if (!workflow || workflow.accountId !== shadow.accountId || workflow.routineId !== shadow.routineId || !workflow.active)
        throw new Error("shadow integration requires an active account-specific workflow registration");
    }
    const url = this.resolveUrl(node, workflow);
    if (!url) throw new Error("no n8n webhook is registered for this routine");
    const target = await checkWebhookTarget(url, this.env, { maxLength: 2000, lookup: this.opts.lookup });
    if (!target.ok) throw new Error(`n8n webhook refused: ${target.reason}`);
    const secret = (this.env[N8N_SECRET_ENV] ?? "").trim();
    if (!secret) throw new Error(`${N8N_SECRET_ENV} is not set — refusing to call n8n unsigned`);
    const receiverHeaders: Record<string, string> = {};
    const readExecution = shadow ? this.opts.readShadowExecution ?? createShadowExecutionReader(this.env, shadow.workflowId, {
      fetch: this.opts.executionFetch, lookup: this.opts.lookup,
    }) : undefined;
    if (shadow) {
      // Separate receiver credential, pinned to this exact URL. Never send it to an
      // owner-edited/global webhook, and never share the root data-token signing key.
      const receiverUrl = (this.env.N8N_SHADOW_RECEIVER_URL ?? "").trim();
      const receiverToken = (this.env.N8N_SHADOW_RECEIVER_TOKEN ?? "").trim();
      if (receiverUrl !== target.url.toString()) throw new Error("shadow receiver URL is not pinned in server configuration");
      if (receiverToken.length < 24 || /\s/.test(receiverToken) || receiverToken === secret)
        throw new Error("shadow receiver requires a separate scoped authentication credential");
      if (!readExecution) throw new Error("independent n8n execution verification is not configured; shadow dispatch is disabled");
      receiverHeaders.authorization = `Bearer ${receiverToken}`;
    }
    const payload = buildN8nPayload(node, ctx, { secret, env: this.env, now: this.now });
    const body = JSON.stringify(payload);
    const ts = String(this.now().getTime());
    const f = this.opts.fetch ?? pinnedWebhookFetch;
    const timeoutMs = node.kind === "n8n" && node.timeoutMs ? node.timeoutMs : (this.opts.timeoutMs ?? N8N_DEFAULT_TIMEOUT_MS);
    let permitId: string | undefined;
    let observedExecutionId: string | undefined;
    if (shadow) {
      if (!this.opts.shadowAdmission || !payload.dataToken || !workflow)
        throw new Error("Durable shadow admission is not configured; provider dispatch is disabled");
      permitId = await this.opts.shadowAdmission.claim({ accountId: identity.accountId,
        contextGeneration: runtimeGeneration(ctx.account.contextGeneration), runId: identity.runId,
        registrationId: workflow.id, contract: shadow, receiverUrl: target.url.toString(),
        requestDigest: shadowRequestDigest(JSON.parse(body)), tokenDigest: shadowTokenDigest(payload.dataToken) });
    }
    const perform = async (): Promise<N8nCallResult> => {
      let res: WebhookResponse;
      try {
        res = await f(target.url.toString(), { method: "POST", redirect: "manual", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(secret, body, ts), [TIMESTAMP_HEADER]: ts, ...receiverHeaders }, body, signal: AbortSignal.timeout(timeoutMs) }, target.pin);
      } catch (err) {
        this.opts.log?.warn("n8n.call_failed", { runId: ctx.runId, routineId: ctx.routineId, error: err instanceof Error ? err.name : "unknown" });
        throw new Error(`n8n webhook unreachable (${err instanceof Error ? err.name : "error"})`);
      }
      if (res.status >= 300 && res.status < 400) throw new Error(`n8n webhook redirect refused (${res.status})`);
      if (res.status === 202) {
        if (shadow) throw new Error("shadow integration requires a synchronous result and execution receipt");
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
      const out = parseN8nReply(parsed, payload.kind, node.kind === "produce" ? node.maxItems : SKILL_BY_ID[ctx.routineId]?.maxItems);
      if (shadow && out.kind === "artifact") {
        const reported = validateShadowReceipt((parsed as { executionReceipt?: unknown }).executionReceipt, shadow, identity, this.now());
        observedExecutionId = String(reported.executionId);
        const candidate = shadowCandidate(out.artifact, reported);
        // Persist the known execution before the next network wait. A crash here
        // must leave a named execution to inspect, not a reason to call n8n again.
        await this.opts.shadowAdmission!.observe(permitId!, observedExecutionId, candidate);
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let observation: unknown;
        try {
          observation = await Promise.race([
            readExecution!({ workflowId: shadow.workflowId, executionId: String(reported.executionId), signal: controller.signal }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("execution verification timed out")); }, 10_000); }),
          ]);
        } catch {
          // Do not leak API response bodies/credentials or retry the paid provider call.
          throw new Error(`n8n execution could not be independently verified; reconcile the execution before rerunning (workflow=${shadow.workflowId}, execution=${reported.executionId})`);
        } finally { clearTimeout(timer); }
        const receipt = verifyShadowExecution(reported, observation, shadow, identity, this.now(), shadowRequestDigest(JSON.parse(body)));
        return verifiedShadowResult(candidate, receipt);
      }
      this.opts.log?.info("n8n.replied", { runId: ctx.runId, routineId: ctx.routineId, kind: out.kind });
      return out;
    };
    try {
      const result = await perform();
      if (permitId) await this.opts.shadowAdmission!.finish(permitId, result.kind === "artifact" ? "verified" : "refused", observedExecutionId, result);
      return result;
    } catch (error) {
      // A crash after claim also leaves a non-reusable dispatching row. Neither an
      // uncertain network outcome nor failed receipt persistence refunds the permit.
      if (permitId) {
        try { await this.opts.shadowAdmission!.finish(permitId, "uncertain", observedExecutionId); }
        catch { this.opts.log?.warn("n8n.reconciliation_required", { runId: identity.runId, permitId }); }
      }
      throw error;
    }
  }
}
