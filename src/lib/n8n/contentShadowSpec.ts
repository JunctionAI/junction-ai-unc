import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { assertValidSpec } from "../runtime/validate";
import type { RoutineSpec } from "../runtime/types";
import { CONTENT_ROUTINES, contentShadowSchema, type ContentShadowContract } from "./contentShadowContract";

/** Replaces TikTok/Gorgias/Instagram catalog reads with a DataForSEO search producer.
 * Preparation does not register, enable, schedule or mint a permit. */
export function contentShadowSpec(contract: ContentShadowContract, version: number): RoutineSpec {
  const pinned = contentShadowSchema.parse(contract);
  const lane = CONTENT_ROUTINES[pinned.routineId];
  const base = CATALOG_SPEC_BY_ID[pinned.routineId];
  const detail = pinned.routineId === "D01-W02"
    ? "Search-derived hook lines from DataForSEO SERP titles. Hypotheses only — not TikTok/Instagram views or viral performance. Nothing publishes."
    : "Search People-Also-Ask questions for the contracted seed. Market research, not support tickets or measured frequency. Nothing publishes.";
  const spec: RoutineSpec = { ...structuredClone(base), version,
    nodes: base.nodes.filter(n => n.kind !== "read").map(node => node.kind === "produce"
      ? { kind: "n8n", id: node.id, timeoutMs: 60_000, shadowContract: pinned }
      : node.kind === "trigger" ? { ...node, cadence: "manual" }
      : node.kind === "gate" ? { ...node, detail }
      : structuredClone(node)),
  };
  if (spec.nodes.find(n => n.kind === "produce")?.kind === "produce") throw new Error("content shadow must replace the built-in producer");
  if (spec.nodes.some(n => n.kind === "read")) throw new Error("content shadow cannot keep native social or ticket reads");
  assertValidSpec(spec);
  if (spec.minimum) spec.minimum = { ...spec.minimum, platforms: [], helpful: [],
    summary: `DataForSEO ${lane.endpoint} for ${pinned.client.seedKeyword} in the selected market` };
  return spec;
}
