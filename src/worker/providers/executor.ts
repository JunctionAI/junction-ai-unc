/* ActionExecutor — the worker's Executor, backed by the typed action library
   (src/lib/actions). It replaces the blanket RefusingExecutor with three honest answers:

     dry run   dryRun(node, mutation, ctx) — the engine asks at every execute node in dry_run
               mode: look the action up, run its guards, return the EXACT request it would
               send (token redacted) + the human line. Guard violations come back as a
               `blocked` reason. Nothing is sent.
     live      execute(node, mutation, ctx) — reached only past the engine's three hard rules
               (approved unexpired gate on this run, mode live, spend caps). Then, in order:
                 1. the mutation must name a registered action    → not_implemented otherwise
                 2. LIVE_MODE_ENABLED must be true                  → live_disabled otherwise
                 3. every risk the action carries must be enabled   → risk_disabled otherwise
                    (ENABLED_ACTION_RISKS from UNC_LIVE_ACTION_RISKS, default none)
                 4. guards must pass                                 → guard_violation otherwise
                 5. the idempotency key must be unseen               → duplicate otherwise
               and only then action.execute(). Errors map to honest reasons (Meta codes →
               token_expired / permission / rate_limited …) and a rate-limited reply sets a
               back-off the executor honours for the rest of its life.
     unknown   a mutation whose action is not registered fails closed with NOT_IMPLEMENTED_REASON
               (the legacy verbs of specs that have not been moved to action ids).

   LIVE_MODE_ENABLED stays false (service.ts) so today every live execute stops at step 2 —
   with a receipt naming the action, the risk and the env var that would enable it.

   RefusingExecutor is kept as the zero-capability fallback (tests, audits). */

import { getAction, idempotencyKey, pickDeclaredParams, risksOf, resolveMetaPreset, ACTION_RISKS, type ActionContext, type ActionCredential, type ActionRisk, type AnyAction, type DryRunResult, type ExecuteResult, type PresetSource, type Violation } from "../../lib/actions";
import type { ExecuteNode, ExecutionResult, Executor, Mutation, RunContext } from "../../lib/runtime/types";
import type { CredentialProvider } from "../credentials";
import type { Logger } from "../log";

export const NOT_IMPLEMENTED_REASON = "not_implemented — mutations are Wave 2, founder-gated";
export const LIVE_DISABLED_REASON = "live_disabled — LIVE_MODE_ENABLED is false (service.ts); the action was shaped, not sent";
export const ENABLED_RISKS_ENV = "UNC_LIVE_ACTION_RISKS";

/** Parse UNC_LIVE_ACTION_RISKS ("reversible,spend") into the enabled set. Unknown words are
    ignored; the default is nothing. */
export function parseEnabledRisks(value: string | undefined | null): Set<ActionRisk> {
  const out = new Set<ActionRisk>();
  for (const raw of (value ?? "").split(/[,\s]+/)) {
    const w = raw.trim().toLowerCase() as ActionRisk;
    if (w && (ACTION_RISKS as readonly string[]).includes(w)) out.add(w);
  }
  return out;
}

/** The enablement map: risk → enabled. Built once from env by the wiring. */
export type EnabledActionRisks = Record<ActionRisk, boolean>;

export function enabledActionRisks(env: Record<string, string | undefined> = process.env): EnabledActionRisks {
  const set = parseEnabledRisks(env[ENABLED_RISKS_ENV]);
  return Object.fromEntries(ACTION_RISKS.map((r) => [r, set.has(r)])) as EnabledActionRisks;
}

export function disabledRisks(action: Pick<AnyAction, "risk" | "secondaryRisks">, enabled: EnabledActionRisks): ActionRisk[] {
  return risksOf(action).filter((r) => !enabled[r]);
}

export function riskDisabledReason(action: Pick<AnyAction, "id" | "risk" | "secondaryRisks">, enabled: EnabledActionRisks): string {
  const off = disabledRisks(action, enabled);
  return `risk_disabled — ${action.id} carries ${off.map((r) => `'${r}'`).join(" + ")} and ${off.length === 1 ? "that risk is" : "those risks are"} not enabled (${ENABLED_RISKS_ENV})`;
}

/** Remembers executed keys so a repeated (runId, actionId, params) is refused. In-memory by
    default; a durable ledger (a table) is the wave-2 follow-up in docs/ACTIONS.md. */
export interface IdempotencyLedger {
  seen(key: string): Promise<boolean>;
  record(key: string, result: { ok: boolean; externalId?: string }): Promise<void>;
}

export class MemoryIdempotencyLedger implements IdempotencyLedger {
  readonly entries = new Map<string, { ok: boolean; externalId?: string }>();
  async seen(key: string) {
    return this.entries.has(key);
  }
  async record(key: string, result: { ok: boolean; externalId?: string }) {
    this.entries.set(key, result);
  }
}

/** Per-day proposal ceiling from the taste ledger; null = no pattern. Injected so this file
    never reads the database. */
export type SpendCeilingSource = (accountId: string, currency: string) => Promise<number | null>;

export interface ActionExecutorDeps {
  liveModeEnabled: boolean;
  enabledRisks?: EnabledActionRisks;
  credentials?: CredentialProvider;
  presets?: PresetSource | null;
  spendCeiling?: SpendCeilingSource;
  ledger?: IdempotencyLedger;
  now?: () => Date;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: Logger;
}

/** What the engine records for a dry-run execute (payload of the draft receipt). */
export interface DryRunReceipt {
  preview: string;
  payload: Record<string, unknown>;
  /** Set when guards would stop it; the engine appends it to the receipt line. */
  blocked?: string;
}

function violationsLine(v: Violation[]): string {
  return v.map((x) => x.message).join("; ");
}

export class ActionExecutor implements Executor {
  /** Every refusal, for tests and audits (same shape as RefusingExecutor.refused). */
  readonly refused: { action: string; platform: string; runId: string }[] = [];
  /** The reason for each refusal, index-aligned with `refused`. */
  readonly refusalReasons: string[] = [];
  /** Set by a rate-limited reply: no mutation until this instant. */
  backoffUntil: number | null = null;
  private readonly enabled: EnabledActionRisks;
  private readonly ledger: IdempotencyLedger;
  private readonly now: () => Date;

  constructor(private readonly deps: ActionExecutorDeps) {
    this.enabled = deps.enabledRisks ?? enabledActionRisks({});
    this.ledger = deps.ledger ?? new MemoryIdempotencyLedger();
    this.now = deps.now ?? (() => new Date());
  }

  get enabledRisks(): EnabledActionRisks {
    return { ...this.enabled };
  }

  private async context(node: ExecuteNode, ctx: RunContext): Promise<ActionContext> {
    let credential: ActionCredential | null = null;
    if (this.deps.credentials) {
      try {
        const c = await this.deps.credentials.get(ctx.account.accountId, node.platform);
        if (c?.kind === "meta_ads") credential = { kind: "meta_ads", adAccountId: c.adAccountId, accessToken: c.accessToken };
        else if (c?.kind === "fixture") credential = { kind: "fixture", marker: c.marker };
      } catch (err) {
        this.deps.log?.warn("executor.credential_failed", { accountId: ctx.account.accountId, platform: node.platform, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    let spendCeiling: number | null = null;
    if (this.deps.spendCeiling) {
      try {
        spendCeiling = await this.deps.spendCeiling(ctx.account.accountId, ctx.account.currency);
      } catch {
        spendCeiling = null;
      }
    }
    return {
      accountId: ctx.account.accountId,
      runId: ctx.runId,
      routineId: ctx.routineId,
      mode: ctx.mode,
      currency: ctx.account.currency,
      caps: ctx.caps,
      preset: await resolveMetaPreset(ctx.account.accountId, this.deps.presets ?? null),
      spendCeiling,
      credential,
      now: this.now(),
      fetch: this.deps.fetch,
      timeoutMs: this.deps.timeoutMs,
    };
  }

  /** target + params, declared keys only. */
  private paramsFor(action: AnyAction, mutation: Mutation): Record<string, unknown> {
    return pickDeclaredParams(action, { ...(mutation.target ?? {}), ...(mutation.params ?? {}) });
  }

  /** Dry run: the exact request + preview, or null when the mutation names no action (the
      engine then keeps its generic "Would <verb>" line). */
  async dryRun(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<DryRunReceipt | null> {
    const action = getAction(mutation.action);
    if (!action) return null;
    const actx = await this.context(node, ctx);
    const params = this.paramsFor(action, mutation);
    const violations = action.guards(params, actx);
    let dry: DryRunResult;
    try {
      dry = action.dryRun(params, actx);
    } catch (err) {
      return { preview: `${action.title} — could not shape the request`, payload: { actionId: action.id, risk: action.risk, risks: risksOf(action), params, violations, error: err instanceof Error ? err.message : String(err) }, blocked: `could not shape the request: ${err instanceof Error ? err.message : String(err)}` };
    }
    const key = idempotencyKey(ctx.runId, action.id, params);
    return {
      preview: dry.preview,
      payload: {
        actionId: action.id,
        title: action.title,
        risk: action.risk,
        risks: risksOf(action),
        params,
        request: dry.request,
        followUps: dry.followUps ?? [],
        spend: dry.spend ?? null,
        before: dry.before ?? null,
        after: dry.after ?? null,
        violations,
        idempotencyKey: key,
        rollback: action.rollback ? action.rollback(params, { ok: true, receipt: "" }) : null,
        enabled: { liveMode: this.deps.liveModeEnabled, risks: this.enabled, disabled: disabledRisks(action, this.enabled) },
        connected: actx.credential?.kind === "meta_ads",
      },
      ...(violations.length ? { blocked: violationsLine(violations) } : {}),
    };
  }

  private refuse(node: ExecuteNode, mutation: Mutation, ctx: RunContext, reason: string, extra: Record<string, unknown> = {}): ExecutionResult {
    this.refused.push({ action: mutation.action, platform: node.platform, runId: ctx.runId });
    this.refusalReasons.push(reason);
    this.deps.log?.info("executor.refused", { action: mutation.action, platform: node.platform, runId: ctx.runId, reason });
    return { ok: false, error: reason, readback: { refused: true, reason, action: mutation.action, platform: node.platform, ...extra } };
  }

  async execute(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<ExecutionResult> {
    const action = getAction(mutation.action);
    if (!action) return this.refuse(node, mutation, ctx, NOT_IMPLEMENTED_REASON);
    if (!this.deps.liveModeEnabled) return this.refuse(node, mutation, ctx, LIVE_DISABLED_REASON, { actionId: action.id, risks: risksOf(action) });
    const off = disabledRisks(action, this.enabled);
    if (off.length) return this.refuse(node, mutation, ctx, riskDisabledReason(action, this.enabled), { actionId: action.id, risks: risksOf(action), disabled: off });

    const actx = await this.context(node, ctx);
    const params = this.paramsFor(action, mutation);
    const violations = action.guards(params, actx);
    if (violations.length) return this.refuse(node, mutation, ctx, `guard_violation — ${violationsLine(violations)}`, { actionId: action.id, violations });

    const key = idempotencyKey(ctx.runId, action.id, params);
    if (await this.ledger.seen(key)) return this.refuse(node, mutation, ctx, `duplicate — this exact action already ran for this run (${key})`, { actionId: action.id, idempotencyKey: key });

    if (this.backoffUntil !== null && this.now().getTime() < this.backoffUntil) {
      return this.refuse(node, mutation, ctx, `rate_limited — backing off Meta until ${new Date(this.backoffUntil).toISOString()}`, { actionId: action.id, backoffUntil: new Date(this.backoffUntil).toISOString() });
    }

    let result: ExecuteResult;
    try {
      result = await action.execute(params, actx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.deps.log?.error("executor.threw", { action: action.id, runId: ctx.runId, reason });
      return { ok: false, error: `${action.id} threw: ${reason}`, readback: { actionId: action.id, idempotencyKey: key } };
    }
    if (result.rateLimit?.throttled) this.backoffUntil = this.now().getTime() + result.rateLimit.backoffMs;
    if (result.error?.code === "rate_limited") this.backoffUntil = this.now().getTime() + (result.error.backoffMs ?? 60_000);
    await this.ledger.record(key, { ok: result.ok, externalId: result.externalId });
    const readback: Record<string, unknown> = {
      actionId: action.id,
      risk: action.risk,
      params,
      idempotencyKey: key,
      receipt: result.receipt,
      response: result.response ?? null,
      sent: result.sent ?? [],
      rateLimit: result.rateLimit ?? null,
      rollback: result.ok && action.rollback ? action.rollback(params, result) : null,
      ...(result.error ? { errorCode: result.error.code, retryable: result.error.retryable, platformError: result.error.platform ?? null } : {}),
    };
    if (!result.ok) return { ok: false, error: result.error ? `${result.error.code} — ${result.error.reason}` : result.receipt, readback };
    return { ok: true, externalRef: result.externalId, readback };
  }
}

/** The zero-capability Executor: every mutation is refused with NOT_IMPLEMENTED_REASON. */
export class RefusingExecutor implements Executor {
  readonly refused: { action: string; platform: string; runId: string }[] = [];

  async execute(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<ExecutionResult> {
    this.refused.push({ action: mutation.action, platform: node.platform, runId: ctx.runId });
    return {
      ok: false,
      error: NOT_IMPLEMENTED_REASON,
      readback: { refused: true, reason: NOT_IMPLEMENTED_REASON, action: mutation.action, platform: node.platform },
    };
  }
}
