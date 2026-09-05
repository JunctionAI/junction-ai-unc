import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { assertValidSpec } from "../runtime/validate";
import type { RoutineSpec } from "../runtime/types";
import { calendarShadowSchema, type CalendarShadowContract } from "./calendarShadowContract";

/** Explicit provider-ownership adapter. Unlike the built-in multi-source calendar,
 * this wrapper owns only Klaviyo campaign metadata. Optional Shopify reads are not
 * silently run first, nor represented as data received by the wrapper. Preparation
 * does not register, enable, schedule, mint a permit or change a customer's spec. */
export function calendarShadowSpec(contract: CalendarShadowContract, version: number): RoutineSpec {
  const pinned = calendarShadowSchema.parse(contract);
  const base = CATALOG_SPEC_BY_ID["D05-W07"];
  const spec: RoutineSpec = { ...structuredClone(base), version,
    nodes: base.nodes.filter(n => n.kind !== "read").map(node => node.kind === "produce"
      ? { kind: "n8n", id: node.id, timeoutMs: 60000, shadowContract: pinned }
      : node.kind === "trigger" ? { ...node, cadence: "manual" }
      : node.kind === "gate" ? { ...node, detail: "Six proposed weeks. Campaign history is metadata, not performance evidence. Unproven timing remains a hypothesis. Nothing is scheduled or sent." }
      : structuredClone(node)),
  };
  assertValidSpec(spec);
  return spec;
}
