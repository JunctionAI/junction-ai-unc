import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { integrationManifest } from "../integrationManifest";

describe("Nguyen handoff inventory", () => {
  it("keeps the committed routine mapping in sync with executable specs", () => {
    const file = path.resolve(__dirname, "../../../../docs/integration/unc-routine-manifest.v1.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(integrationManifest());
    expect(integrationManifest().routines).toHaveLength(35);
  });
  it("exposes pre-produce decisions rather than promising a whole-workflow replacement", () => {
    const paid = integrationManifest().routines.find(r => r.routineId === "D02-W03")!;
    expect(paid.replacesWholeWorkflow).toBe(false);
    expect(paid.stepsBeforeN8nReplacement.some(n => n.kind === "check")).toBe(true);
    expect(paid.stepsBeforeN8nReplacement.some(n => n.kind === "decide")).toBe(true);
  });
});
