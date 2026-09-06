import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { integrationManifest } from "../integrationManifest";
import { SKILL_BY_ID } from "../../runtime/skills";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";
import { parseN8nReply } from "../../../worker/providers/n8n";

describe("Nguyen handoff inventory", () => {
  it("keeps the committed routine mapping in sync with executable specs", () => {
    const file = path.resolve(__dirname, "../../../../docs/integration/unc-routine-manifest.v1.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(integrationManifest());
    expect(integrationManifest().routines).toHaveLength(36);
  });
  it("exposes pre-produce decisions rather than promising a whole-workflow replacement", () => {
    const paid = integrationManifest().routines.find(r => r.routineId === "D02-W03")!;
    expect(paid.replacesWholeWorkflow).toBe(false);
    expect(paid.stepsBeforeN8nReplacement.some(n => n.kind === "check")).toBe(true);
    expect(paid.stepsBeforeN8nReplacement.some(n => n.kind === "decide")).toBe(true);
  });
  it("exports the actual artifact guide and full retained checks/gates for every routine", () => {
    for (const routine of integrationManifest().routines) {
      const skill = SKILL_BY_ID[routine.routineId], spec = CATALOG_SPEC_BY_ID[routine.routineId];
      expect(routine.outputGuide).toBe(skill.outputSpec);
      expect(routine.outputGuideIsSchema).toBe(false);
      expect(JSON.parse(routine.outputGuide!).kind).toBe(routine.outputKind);
      expect(routine.maxItems).toBe(skill.maxItems);
      const index = spec.nodes.findIndex(n=>n.kind === "produce" || n.kind === "n8n");
      expect(routine.preProducerDefinition).toEqual(spec.nodes.slice(0,index));
      expect(routine.postProducerDefinition).toEqual(spec.nodes.slice(index+1));
      expect(routine.postProducerDefinition.some(n=>n.kind === "gate")).toBe(true);
    }
  });
  it("maps 18 reported capabilities across five lanes, reserving distinct new IDs without enabling them", () => {
    const packet = integrationManifest().packaging;
    expect(packet.lanes).toHaveLength(18);
    expect(new Set(packet.lanes.map(l=>l.area)).size).toBe(5);
    expect(new Set(packet.lanes.map(l=>l.routineId)).size).toBe(18);
    for (const lane of packet.lanes) {
      if (lane.adapter === "reserved_not_executable") expect(CATALOG_SPEC_BY_ID[lane.routineId]).toBeUndefined();
      else expect(CATALOG_SPEC_BY_ID[lane.routineId]).toBeDefined();
    }
    expect(packet.lanes.find(l=>l.capability === "competitor_backlink_gap")?.routineId).toBe("D03-W07");
    expect(packet.lanes.find(l=>l.capability === "bofu_campaign_plan")?.routineId).toBe("D02-W09");
    expect(packet.lanes.find(l=>l.capability === "serp_position_watch")?.adapter).toBe("source_semantics_change_required");
    expect(packet.blockedInputs.map(l=>l.routineId)).toEqual(["D02-W05","D02-W08","D03-W03","D03-W04","D05-W02","D05-W04"]);
  });
  it("does not confuse a syntactically valid output guide with verified execution evidence", () => {
    const routine = integrationManifest().routines.find(r=>r.routineId === "D01-W03")!;
    const parsed = parseN8nReply({artifact:JSON.parse(routine.outputGuide!)},routine.outputKind!,routine.effectiveProduceMaxItems);
    expect(parsed.kind).toBe("artifact");
    expect(integrationManifest().packaging.evidenceStatus).toContain("not verified Unc");
  });
});
