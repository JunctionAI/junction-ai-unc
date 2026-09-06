import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { assertValidSpec } from "../runtime/validate";
import type { GateNode, RoutineSpec } from "../runtime/types";
import { paidShadowSchema, type PaidShadowContract } from "./paidShadowContract";

const DETAIL: Record<"meta" | "google_ads", string> = {
  meta: "A shadow recommendation from the registered Meta workflow, judged on observed ad-account data in the account currency. Any CPA ceiling it cites is 50% of a verified product price in that same currency; an unmapped price means hold. Nothing is applied to Meta.",
  google_ads: "A shadow BOFU Search plan from the registered workflow for one market, staged PAUSED. Keyword demand is an observation; the plan is a proposal. Nothing is created or changed in Google Ads.",
};

/** Explicit provider-ownership adapter for AVGAR's paid lanes. The catalog's reads, checks,
 * decisions and EXECUTE nodes are removed: n8n owns the provider read through its native
 * credential, Unc keeps the draft gate, and no execute node can follow. Preparation does
 * not register, enable, schedule, mint a permit or change a customer's spec. */
export function paidShadowSpec(contract: PaidShadowContract, version: number): RoutineSpec {
  const pinned = paidShadowSchema.parse(contract);
  const base = CATALOG_SPEC_BY_ID[pinned.routineId];
  if (!base) throw new Error(`no catalog spec for ${pinned.routineId}`);
  const gate = base.nodes.find((n): n is GateNode => n.kind === "gate");
  const receipt = base.nodes.find(n => n.kind === "receipt");
  if (!gate || !receipt) throw new Error(`catalog spec ${pinned.routineId} lacks a gate or receipt`);
  const spec: RoutineSpec = {
    ...structuredClone(base), version, mutates: false,
    nodes: [
      { kind: "trigger", id: "trigger", cadence: "manual" },
      { kind: "n8n", id: "produce", timeoutMs: 60000, shadowContract: pinned },
      { kind: "gate", id: gate.id, title: "{{artifact.title}}", expiryHours: gate.expiryHours, detail: DETAIL[pinned.lane], after: "Shadow recommendation in your queue" },
      structuredClone(receipt),
    ],
  };
  assertValidSpec(spec);
  return spec;
}

export function isPaidShadowSpec(spec: RoutineSpec): boolean {
  const node = spec.nodes[1];
  return !spec.mutates && node?.kind === "n8n" && !!node.shadowContract && node.shadowContract.contract === "unc.paid-ads-shadow.v1" &&
    spec.nodes.length === 4 && spec.nodes[0]?.kind === "trigger" && spec.nodes[0].cadence === "manual";
}
