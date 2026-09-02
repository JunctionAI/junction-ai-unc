/* Context helpers: dotted-path resolution over the run context, {{template}}
   rendering, predicate evaluation, spend resolution, ids and hashing.
   Pure functions — no I/O. */

import type { CompareOp, Predicate, PredicateValue, RunContext, SpendAmount, SpendDescriptor } from "./types";

// ---------- path resolution ----------

/** The addressable view of a run context. `reads.<as>.count` is the row
    count; `reads.<as>.<metric>` reads metrics first, then the raw result. */
function view(ctx: RunContext): Record<string, unknown> {
  return {
    run: { id: ctx.runId, mode: ctx.mode, startedAt: ctx.startedAt, triggeredBy: ctx.triggeredBy },
    routine: { id: ctx.routineId, version: ctx.version },
    account: ctx.account,
    caps: ctx.caps,
    today: ctx.startedAt.slice(0, 10),
    reads: ctx.reads,
    checks: ctx.checks,
    decision: ctx.decision,
    approval: ctx.approval,
    execution: ctx.execution,
    vars: ctx.vars,
  };
}

function isReadResult(v: unknown): v is { rows: unknown[]; metrics: Record<string, unknown> } {
  return !!v && typeof v === "object" && Array.isArray((v as { rows?: unknown }).rows) && typeof (v as { metrics?: unknown }).metrics === "object";
}

export function resolvePath(ctx: RunContext, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = view(ctx);
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (isReadResult(cur)) {
      if (part === "count") {
        cur = cur.rows.length;
        continue;
      }
      if (part in cur.metrics) {
        cur = cur.metrics[part];
        continue;
      }
    }
    if (Array.isArray(cur)) {
      if (part === "length" || part === "count") {
        cur = cur.length;
        continue;
      }
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
      continue;
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cur;
}

// ---------- templating ----------

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Replace every {{path}} with the value at that path (empty string when
    unresolved, so a half-known template still renders). */
export function renderTemplate(template: string | undefined, ctx: RunContext): string {
  if (!template) return "";
  return template.replace(TEMPLATE_RE, (_, path: string) => formatValue(resolvePath(ctx, path)));
}

/** Render every string leaf of a params object (one level of nesting deep
    enough for mutation params). */
export function renderParams(params: Record<string, unknown> | undefined, ctx: RunContext): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") {
      const whole = v.match(/^\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}$/);
      // a lone {{path}} keeps its native type (numbers stay numbers)
      out[k] = whole ? (resolvePath(ctx, whole[1]) ?? "") : renderTemplate(v, ctx);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = renderParams(v as Record<string, unknown>, ctx);
    } else out[k] = v;
  }
  return out;
}

// ---------- predicates ----------

/** Resolve a predicate value: literals pass through, { ref } reads the context. */
export function resolveValue(value: PredicateValue | undefined, ctx: RunContext): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "ref" in value) return resolvePath(ctx, value.ref);
  return value;
}

export function compare(actual: unknown, op: CompareOp, expected?: unknown): boolean {
  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "between": {
      if (!Array.isArray(expected) || typeof actual !== "number") return false;
      const [lo, hi] = expected as [number, number];
      return actual >= lo && actual <= hi;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      if (op === "gt") return actual > expected;
      if (op === "gte") return actual >= expected;
      if (op === "lt") return actual < expected;
      return actual <= expected;
    }
  }
}

export function evaluatePredicate(pred: Predicate, ctx: RunContext): boolean {
  if ("all" in pred) return pred.all.every((p) => evaluatePredicate(p, ctx));
  if ("any" in pred) return pred.any.some((p) => evaluatePredicate(p, ctx));
  return compare(resolvePath(ctx, pred.metric), pred.op, resolveValue(pred.value, ctx));
}

/** Flat description of a predicate for receipts ("reads.orders.count gte 5"). */
export function describePredicate(pred: Predicate, ctx: RunContext): string {
  if ("all" in pred) return pred.all.map((p) => `(${describePredicate(p, ctx)})`).join(" AND ");
  if ("any" in pred) return pred.any.map((p) => `(${describePredicate(p, ctx)})`).join(" OR ");
  const actual = resolvePath(ctx, pred.metric);
  const window = pred.window ? ` over ${pred.window}` : "";
  const expected = resolveValue(pred.value, ctx);
  const shown = pred.value && typeof pred.value === "object" && !Array.isArray(pred.value) ? `${pred.value.ref} (${formatValue(expected)})` : formatValue(expected);
  return `${pred.metric}${window} = ${formatValue(actual)} ${pred.op} ${shown}`;
}

// ---------- spend ----------

export function resolveSpend(desc: SpendDescriptor | undefined, ctx: RunContext): SpendAmount | undefined {
  if (!desc) return undefined;
  const period = desc.period ?? "once";
  if ("amount" in desc) return { amount: round2(desc.amount), currency: ctx.account.currency, period };
  const base = resolvePath(ctx, desc.amountMetric);
  if (typeof base !== "number") return { amount: 0, currency: ctx.account.currency, period };
  let amount = base * (desc.multiplier ?? 1);
  if (desc.max !== undefined) amount = Math.min(amount, desc.max);
  return { amount: round2(Math.max(0, amount)), currency: ctx.account.currency, period };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- ids / time / hashing ----------

export function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // RFC-4122-ish fallback for exotic runtimes
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

export function startOfDayUtc(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export function startOfMonthUtc(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Stable (key-sorted) JSON, then FNV-1a — enough to detect "the dry run ran
    exactly this draft". Not cryptographic. */
export function stableHash(value: unknown): string {
  const json = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + json.length.toString(16);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
