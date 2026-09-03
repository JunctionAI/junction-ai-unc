/* Typed action library — the contract.

   An Action is the ONLY way a routine touches a platform. It is data plus four small
   functions:

     guards(params, ctx)   → violations   pure; every reason a proposal must not run
     dryRun(params, ctx)   → the EXACT request(s) it would send (token redacted) + one
                             human line + the spend it commits. Pure. Never fetches.
     execute(params, ctx)  → sends the request(s). Only reachable through the worker's
                             ActionExecutor in live mode with the action's risk enabled
                             (src/worker/providers/executor.ts) — and LIVE_MODE_ENABLED
                             is false today, so nothing in this tree mutates anything.
     rollback?(params, r)  → the inverse invocation, as data, for the receipt.

   Risk is the coarse enablement class:
     read         reads only; no state change on the platform
     reversible   a state change with an exact inverse (pause ↔ resume)
     spend        commits or changes money (budgets)
     publish      creates something the public / the auction can see
     destructive  no inverse (delete) — nothing in the Meta set carries this

   Idempotency: every execute is keyed by (runId, actionId, params hash) —
   idempotencyKey() in registry.ts — and the executor's ledger refuses a repeat.

   Nothing here imports the database, the worker or the network: the executor injects the
   credential, the preset, the taste ceiling and fetch through ActionContext. Relative
   imports only (this tree is part of the standalone worker build). */

import type { RunMode, SpendCaps } from "../runtime/types";
import type { MetaPreset } from "./presets";

export type ActionRisk = "read" | "reversible" | "spend" | "publish" | "destructive";
export const ACTION_RISKS: readonly ActionRisk[] = ["read", "reversible", "spend", "publish", "destructive"] as const;

/** Platforms with actions today. Mirrors runtime Platform for the ones that mutate. */
export type ActionPlatform = "meta_ads";

// ---------- params descriptor (JSON-schema-like, typed) ----------

export type ParamType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface ParamSpec {
  type: ParamType;
  description: string;
  required?: boolean;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  /** For arrays: the element descriptor. */
  items?: ParamSpec;
  /** For objects: nested descriptors. */
  properties?: Record<string, ParamSpec>;
  /** Shown in prompts / the inspector: "{{decision.params.adsetId}}" etc. */
  example?: unknown;
}

export interface ParamsSchema {
  type: "object";
  properties: Record<string, ParamSpec>;
}

// ---------- context the executor injects ----------

/** What an action needs to know about the credential. Structurally the worker's
    PlatformCredential meta_ads variant (src/worker/credentials.ts); declared here so this
    tree never imports the worker. */
export type ActionCredential = { kind: "meta_ads"; adAccountId: string; accessToken: string } | { kind: "fixture"; marker: string };

export interface ActionContext {
  accountId: string;
  runId: string;
  routineId: string;
  mode: RunMode;
  currency: string;
  caps: SpendCaps;
  /** The account's Meta decision preset (defaults when none is stored). */
  preset: MetaPreset;
  /** Per-day proposal ceiling from the approvals ledger (brain/taste.ts suggestedSpendCeiling); null = no pattern. */
  spendCeiling: number | null;
  /** null = nothing connected. Dry runs shape the request without one. */
  credential: ActionCredential | null;
  now: Date;
  /** Injected by the executor for execute(); tests stub it. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// ---------- results ----------

export interface Violation {
  /** Stable machine code, e.g. "cap_per_day", "step_limit", "missing_param". */
  code: string;
  message: string;
  param?: string;
  limit?: number | string;
  actual?: number | string;
}

/** One HTTP request, exactly as it would be sent — with the credential redacted. */
export interface ShapedRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  /** Redacted: "Authorization: Bearer ••••". */
  headers: Record<string, string>;
  /** Form/JSON body as key → value; absent for GET. Never carries a token. */
  body?: Record<string, unknown>;
  /** What this request does, one line ("pause ad set 1234"). */
  note: string;
}

export interface ActionSpend {
  amount: number;
  currency: string;
  /** True when the amount is a per-day rate (a daily budget), not a one-off. */
  perDay?: boolean;
}

export interface DryRunResult {
  request: ShapedRequest;
  /** Further requests for multi-step actions (campaign → ad set → ad), in order. */
  followUps?: ShapedRequest[];
  /** The human line: "Set ad set 1234 daily budget NZ$60 → NZ$72 (+20%)". */
  preview: string;
  spend?: ActionSpend;
  before?: string;
  after?: string;
}

export interface ActionError {
  /** Stable class: token_expired | permission | rate_limited | invalid_param | policy | transient | http | unknown. */
  code: string;
  /** The honest reason for the receipt. */
  reason: string;
  retryable: boolean;
  /** Meta's own numbers, when present. */
  platform?: { code?: number; subcode?: number; type?: string; traceId?: string };
  /** Back-off the executor should honour before the next call, when rate-limited. */
  backoffMs?: number;
}

export interface ExecuteResult<R = Record<string, unknown>> {
  ok: boolean;
  /** The platform id of what was created / changed (campaign id, image hash). */
  externalId?: string;
  /** The platform's reply, redacted. */
  response?: R;
  /** One line for the mutation receipt. */
  receipt: string;
  error?: ActionError;
  /** The requests that were actually sent (redacted), for the audit trail. */
  sent?: ShapedRequest[];
  rateLimit?: RateLimitState | null;
}

/** Parsed from X-Business-Use-Case-Usage / X-Ad-Account-Usage / X-App-Usage. */
export interface RateLimitState {
  /** Highest utilisation seen across the usage headers, 0–100. */
  utilisationPct: number;
  /** Minutes Meta says to wait before access resumes (0 when not throttled). */
  regainAccessMinutes: number;
  /** True when we should stop calling for a while. */
  throttled: boolean;
  /** Milliseconds to wait before the next mutation. */
  backoffMs: number;
  source: "business_use_case" | "ad_account" | "app" | "none";
}

export interface RollbackPlan {
  actionId: string;
  params: Record<string, unknown>;
  note: string;
}

// ---------- the action ----------

export interface Action<P extends Record<string, unknown> = Record<string, unknown>, R = Record<string, unknown>> {
  /** "meta.adset.set_daily_budget" — platform.noun.verb. */
  id: string;
  platform: ActionPlatform;
  title: string;
  description: string;
  risk: ActionRisk;
  /** Further risk classes the action also carries (create_from_brief is publish + spend);
      the executor requires EVERY listed risk to be enabled. */
  secondaryRisks?: ActionRisk[];
  params: ParamsSchema;
  /** Pure. Empty array = the proposal may run. Missing/invalid params are violations too. */
  guards(params: P, ctx: ActionContext): Violation[];
  /** Pure. The exact request the action WOULD send, token redacted. */
  dryRun(params: P, ctx: ActionContext): DryRunResult;
  /** Sends it. Never called unless the executor's gates all pass. */
  execute(params: P, ctx: ActionContext): Promise<ExecuteResult<R>>;
  /** The inverse, as an invocation of another (or the same) action. */
  rollback?(params: P, result: ExecuteResult<R>): RollbackPlan | null;
}

/** An action bound to concrete params — what a decision proposes. */
export interface ActionProposal {
  actionId: string;
  params: Record<string, unknown>;
}
