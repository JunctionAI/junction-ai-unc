import { CATALOG_SPECS } from "../runtime/catalog-specs";
import { SKILL_BY_ID } from "../runtime/skills";
import { scopesForSpec } from "./dataToken";
import { SHADOW_LANE_HANDOFF, SHADOW_LANE_BLOCKED_INPUTS } from "./laneHandoff";

/** Derived from executable specs, not a separately maintained list of routine names. */
export function integrationManifest() {
  return {
    schema: "unc.integration-manifest.v1",
    readiness: "contract inventory only; no deployment or provider readiness implied",
    keywordPilot: { routineId: "D03-W01", contract: "unc.keyword-shadow.v1", reply: ["artifact", "executionReceipt"], fallbackAllowed: false, timeoutMs: 60_000 },
    packaging: {
      status: "No activation authority. Later-lane adapters and callable contracts remain Codex work.",
      evidenceStatus: "Nguyen-reported historical shadow results, not verified Unc executions",
      lanes: structuredClone(SHADOW_LANE_HANDOFF), blockedInputs: structuredClone(SHADOW_LANE_BLOCKED_INPUTS),
    },
    routines: CATALOG_SPECS.map(spec => {
      const skill = SKILL_BY_ID[spec.id];
      const produceIndex = spec.nodes.findIndex(n => n.kind === "produce" || n.kind === "n8n");
      return {
        routineId: spec.id, version: spec.version, name: skill?.name ?? spec.id,
        outputKind: skill?.kind, outputContractSource: "src/lib/runtime/skills (SKILL_BY_ID[routineId].outputSpec)", minimum: skill?.minimum,
        outputGuide: skill?.outputSpec, outputGuideIsSchema: false,
        maxItems: skill?.maxItems,
        effectiveProduceMaxItems: spec.nodes[produceIndex]?.kind === "produce" ? spec.nodes[produceIndex].maxItems ?? skill?.maxItems : skill?.maxItems,
        semanticCheckSource: "src/lib/runtime/skills (SKILL_BY_ID[routineId].check + prompt)",
        reads: spec.nodes.filter(n => n.kind === "read").map(n => ({ nodeId: n.id, as: n.as, platform: n.source, query: n.query, optional: n.optional ?? false, freshnessMinutes: n.freshnessMinutes ?? null })),
        scopes: scopesForSpec(spec),
        stepsBeforeN8nReplacement: spec.nodes.slice(0, Math.max(0, produceIndex)).map(n => ({ id: n.id, kind: n.kind })),
        preProducerDefinition: structuredClone(spec.nodes.slice(0, Math.max(0, produceIndex))),
        postProducerDefinition: structuredClone(produceIndex < 0 ? [] : spec.nodes.slice(produceIndex + 1)),
        replacesWholeWorkflow: false,
        warning: "Registering a produce-step webhook does not bypass earlier reads/checks/decisions. An explicit shadow adapter is required when n8n owns those decisions.",
        actions: spec.nodes.filter(n => n.kind === "execute").map(n => ({ platform: n.platform, mutation: n.mutation })),
      };
    }),
  };
}
