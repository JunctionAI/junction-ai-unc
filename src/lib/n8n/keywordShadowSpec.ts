import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { assertValidSpec } from "../runtime/validate";
import type { RoutineSpec } from "../runtime/types";
import type { KeywordShadowContract } from "./shadowContract";

/** Preparation only: does not register a URL, enable a routine, or write a spec to storage.
 * The explicit n8n step cannot silently fall back to the built-in keyword generator. */
export function keywordShadowSpec(contract: KeywordShadowContract, version: number): RoutineSpec {
  const base = CATALOG_SPEC_BY_ID["D03-W01"];
  const spec: RoutineSpec = {
    ...base, version,
    nodes: base.nodes.map(node => node.kind === "produce"
      ? { kind: "n8n", id: node.id, timeoutMs: 60_000, shadowContract: contract }
      : node.kind === "trigger" ? { ...node, cadence: "manual" } : node),
  };
  assertValidSpec(spec);
  return spec;
}
