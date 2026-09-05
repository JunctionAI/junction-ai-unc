/* Structural validation of a RoutineSpec. Runs before every execution and
   before a draft can be dry-run or promoted. Pure. */

import type { Node, NodeKind, Platform, Predicate, RoutineSpec } from "./types";
import { protocolProblem as shadowContractProblem } from "../n8n/shadowProtocols";

export interface ValidationIssue {
  path: string;
  message: string;
}

export class SpecValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Invalid routine spec: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "SpecValidationError";
  }
}

export const ROUTINE_ID_RE = /^D0[1-5]-W0[1-8]$/;
const CRON_RE = /^(\S+\s+){4}\S+$/;
const EVENT_RE = /^event:[a-z0-9_]+:[a-z0-9_]+$/;

export const PLATFORMS: readonly Platform[] = [
  "shopify",
  "ga4",
  "meta_ads",
  "google_ads",
  "klaviyo",
  "instagram",
  "tiktok",
  "linkedin",
  "youtube",
  "search_console",
  "hubspot",
  "gmail",
  "gorgias",
  "xero",
  "quickbooks",
  "slack",
  "web",
  "llm_search",
  "calendar",
];

/** Canonical chain order. Reads and checks may repeat; the rest are single. produce and n8n
    share a rank (a chain may carry one of each, in either order). */
const RANK: Record<NodeKind, number> = { trigger: 0, read: 1, check: 2, decide: 3, produce: 4, n8n: 4, gate: 5, execute: 6, receipt: 7 };
const SINGLETON: NodeKind[] = ["trigger", "decide", "produce", "n8n", "gate", "execute", "receipt"];

export function isValidCadence(cadence: string): boolean {
  return cadence === "manual" || EVENT_RE.test(cadence) || CRON_RE.test(cadence.trim());
}

function validatePredicate(pred: Predicate, path: string, issues: ValidationIssue[]) {
  if ("all" in pred) {
    if (!pred.all.length) issues.push({ path, message: "all[] is empty" });
    pred.all.forEach((p, i) => validatePredicate(p, `${path}.all[${i}]`, issues));
    return;
  }
  if ("any" in pred) {
    if (!pred.any.length) issues.push({ path, message: "any[] is empty" });
    pred.any.forEach((p, i) => validatePredicate(p, `${path}.any[${i}]`, issues));
    return;
  }
  if (!pred.metric) issues.push({ path, message: "metric is required" });
  if (pred.op !== "exists" && pred.value === undefined) issues.push({ path, message: `op ${pred.op} needs a value` });
  if (pred.op === "between" && !(Array.isArray(pred.value) && pred.value.length === 2)) issues.push({ path, message: "between needs [lo, hi]" });
  if (pred.value && typeof pred.value === "object" && !Array.isArray(pred.value) && !pred.value.ref) issues.push({ path, message: "value.ref must be a context path" });
}

export function validateSpec(spec: RoutineSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (!ROUTINE_ID_RE.test(spec.id ?? "")) push("id", `must match D0x-W0y, got "${spec.id}"`);
  if (!Number.isInteger(spec.version) || spec.version < 1) push("version", "must be a positive integer");
  if (!spec.name) push("name", "is required");
  if (spec.wave !== 1 && spec.wave !== 2) push("wave", "must be 1 or 2");

  const nodes: Node[] = Array.isArray(spec.nodes) ? spec.nodes : [];
  if (!nodes.length) {
    push("nodes", "must not be empty");
    return issues;
  }

  // order + cardinality
  const seen = new Map<NodeKind, number>();
  const ids = new Set<string>();
  let lastRank = -1;
  nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!n || !(n.kind in RANK)) {
      push(path, `unknown node kind "${(n as { kind?: string })?.kind}"`);
      return;
    }
    if (!n.id) push(path, "id is required");
    else if (ids.has(n.id)) push(path, `duplicate node id "${n.id}"`);
    ids.add(n.id);
    const rank = RANK[n.kind];
    if (rank < lastRank) push(path, `${n.kind} cannot follow ${nodes[i - 1].kind} (order is trigger→read→check→decide→produce|n8n→gate→execute→receipt)`);
    lastRank = Math.max(lastRank, rank);
    seen.set(n.kind, (seen.get(n.kind) ?? 0) + 1);
  });
  if (nodes[0].kind !== "trigger") push("nodes[0]", "chain must start with a trigger");
  if (nodes[nodes.length - 1].kind !== "receipt") push(`nodes[${nodes.length - 1}]`, "chain must end with a receipt");
  for (const k of SINGLETON) if ((seen.get(k) ?? 0) > 1) push("nodes", `only one ${k} node is allowed`);

  // per-node rules
  const aliases = new Set<string>();
  let gateIndex = -1;
  nodes.forEach((n, i) => {
    const path = `nodes[${i}](${n.kind})`;
    switch (n.kind) {
      case "trigger":
        if (!isValidCadence(n.cadence ?? "")) push(path, `cadence must be "manual", "event:<platform>:<event>" or a 5-field cron, got "${n.cadence}"`);
        break;
      case "read":
        if (!PLATFORMS.includes(n.source)) push(path, `unknown source platform "${n.source}"`);
        if (!n.query?.resource) push(path, "query.resource is required");
        if (!n.as) push(path, "as (context alias) is required");
        else if (aliases.has(n.as)) push(path, `duplicate read alias "${n.as}"`);
        aliases.add(n.as);
        if (n.freshnessMinutes !== undefined && n.freshnessMinutes <= 0) push(path, "freshnessMinutes must be > 0");
        break;
      case "check":
        if (!n.predicate) push(path, "predicate is required");
        else validatePredicate(n.predicate, `${path}.predicate`, issues);
        break;
      case "decide": {
        if (!n.question) push(path, "question is required");
        if (!n.options?.length) push(path, "needs at least one option");
        const optIds = new Set<string>();
        (n.options ?? []).forEach((o, j) => {
          if (!o.id) push(`${path}.options[${j}]`, "id is required");
          if (optIds.has(o.id)) push(`${path}.options[${j}]`, `duplicate option id "${o.id}"`);
          optIds.add(o.id);
          if (!o.label) push(`${path}.options[${j}]`, "label is required");
        });
        const r = n.rule;
        if (!r) push(path, "rule is required");
        else if (r.kind === "threshold") {
          if (!optIds.has(r.ifTrue)) push(`${path}.rule`, `ifTrue "${r.ifTrue}" is not an option`);
          if (!optIds.has(r.ifFalse)) push(`${path}.rule`, `ifFalse "${r.ifFalse}" is not an option`);
          if (!r.metric) push(`${path}.rule`, "metric is required");
        } else if (r.kind === "llm") {
          if (!r.prompt) push(`${path}.rule`, "prompt is required");
          if (r.fallback && !optIds.has(r.fallback)) push(`${path}.rule`, `fallback "${r.fallback}" is not an option`);
        } else if (r.kind !== "first") push(`${path}.rule`, `unknown rule kind "${(r as { kind: string }).kind}"`);
        break;
      }
      case "produce":
        if (n.maxItems !== undefined && !(Number.isInteger(n.maxItems) && n.maxItems > 0)) push(path, "maxItems must be a positive integer");
        break;
      case "n8n":
        if (n.shadowContract !== undefined) {
          const problem = shadowContractProblem(n.shadowContract);
          if (problem) push(path, problem);
          if (n.shadowContract?.routineId !== spec.id) push(path, "shadow routine must match the enclosing spec");
          if (spec.mutates) push(path, "shadow contract cannot be used in a mutating spec");
        }
        if (n.timeoutMs !== undefined && !(n.timeoutMs > 0)) push(path, "timeoutMs must be > 0");
        if (n.webhookUrl !== undefined && !/^https?:\/\//.test(n.webhookUrl)) push(path, "webhookUrl must be an http(s) URL");
        if (n.webhookUrlEnv !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(n.webhookUrlEnv)) push(path, "webhookUrlEnv must be an env variable name");
        break;
      case "gate":
        if (!n.title) push(path, "title is required");
        if (!(n.expiryHours > 0)) push(path, "expiryHours must be > 0");
        gateIndex = i;
        break;
      case "execute":
        if (gateIndex < 0 || gateIndex > i) push(path, "execute requires a gate node earlier in the chain");
        if (!PLATFORMS.includes(n.platform)) push(path, `unknown platform "${n.platform}"`);
        if (!n.mutation?.action) push(path, "mutation.action is required");
        break;
      case "receipt":
        if (n.measurementWindowDays !== undefined && n.measurementWindowDays <= 0) push(path, "measurementWindowDays must be > 0");
        break;
    }
  });

  // classification consistency
  const hasExecute = (seen.get("execute") ?? 0) > 0;
  if (spec.mutates !== hasExecute) push("mutates", `is ${spec.mutates} but the chain ${hasExecute ? "has" : "has no"} execute node`);
  if (spec.wave === 1 && spec.mutates) push("wave", "wave-1 routines are draft-only and cannot mutate");

  return issues;
}

export function assertValidSpec(spec: RoutineSpec): void {
  const issues = validateSpec(spec);
  if (issues.length) throw new SpecValidationError(issues);
}
