import { describe, expect, it } from "vitest";
import { planSeoPackage, reconcileSeoPageProposals, type SeoPackageInput, type SeoStepResult } from "../seoPackage";

const scope = { accountId: "avgar", contextGeneration: 1, market: "US" as const, cycleId: "2026-09-06" };
const result: SeoStepResult = { ...scope, stepId: "keywords", artifactId: "keywords-1", artifactRevision: 0,
  runId: "run-1", completedAt: "2026-09-06T02:00:00Z", validUntil: "2026-09-07T02:00:00Z", inputs: [] };
function input(overrides: Partial<SeoPackageInput> = {}): SeoPackageInput {
  return { ...scope, now: "2026-09-06T03:00:00Z", enabledRoutineIds: ["D03-W01", "D03-W02", "D03-W04"],
    prepareArticles: true, readySteps: ["keywords", "gaps", "page_edits", "articles"], results: [], ...overrides };
}
describe("coordinated SEO work package (no provider calls)", () => {
  it("starts with research and blocks dependent drafting", () => {
    const p = planSeoPackage(input());
    expect(p.steps.filter(s => s.state === "ready").map(s => s.id)).toEqual(["keywords"]);
    expect(p.publishEnabled).toBe(false);
  });
  it("shares the exact saved research revision with both downstream steps", () => {
    const p = planSeoPackage(input({ results: [result] }));
    for (const id of ["gaps", "page_edits"]) expect(p.steps.find(s => s.id === id)).toMatchObject({ state: "ready", inputs: [{ artifactId: "keywords-1", artifactRevision: 0 }] });
    expect(p.steps.find(s => s.id === "articles")?.state).toBe("blocked");
  });
  it.each([{ accountId: "foreign" }, { contextGeneration: 0 }, { market: "NZ" as const }, { cycleId: "old" },
    { validUntil: "2026-09-06T03:00:00Z" }, { completedAt: "2026-09-07T00:00:00Z" }])("rejects out-of-scope or stale result %j", change => {
    expect(planSeoPackage(input({ results: [{ ...result, ...change }] })).steps[0].state).toBe("ready");
  });
  it("never turns on a prerequisite behind the customer switch", () => {
    const p = planSeoPackage(input({ enabledRoutineIds: ["D03-W02"], results: [result] }));
    expect(p.steps[0].state).toBe("off");
    expect(p.steps[1].state).toBe("blocked");
  });
  it("requires explicit article preparation, not an invented routine mapping", () => {
    const p = planSeoPackage(input({ prepareArticles: false }));
    expect(p.steps.find(s => s.id === "articles")).toMatchObject({ routineId: null, state: "off" });
  });
  it("does not call the package complete from keywords alone", () => {
    expect(planSeoPackage(input({ results: [result] })).status).toBe("incomplete");
  });
  it("invalidates downstream work when its research revision changes", () => {
    const gap: SeoStepResult = { ...result, stepId: "gaps", artifactId: "gap-1", inputs: [{ artifactId: result.artifactId, artifactRevision: 0 }] };
    expect(planSeoPackage(input({ results: [result, gap] })).steps[1].state).toBe("complete");
    expect(planSeoPackage(input({ results: [{ ...result, artifactRevision: 1 }, gap] })).steps[1].state).toBe("ready");
  });
  it("keeps missing adapters visible", () => {
    expect(planSeoPackage(input({ readySteps: [] })).steps[0].state).toBe("blocked");
  });
  it("a finished research-only selection means review, never publishing", () => {
    const p = planSeoPackage(input({ enabledRoutineIds: ["D03-W01"], prepareArticles: false, results: [result] }));
    expect(p.status).toBe("ready_for_review"); expect(p.publishEnabled).toBe(false);
  });
  it("does not report an empty selection as ready", () => {
    expect(planSeoPackage(input({ enabledRoutineIds: [], prepareArticles: false })).status).toBe("off");
  });
  it("deduplicates intent and prefers improving the observed existing page", () => {
    expect(reconcileSeoPageProposals([
      { intentKey: "Flying with golf bags", kind: "new_article", sourceArtifactId: "k" },
      { intentKey: " flying with golf bags ", kind: "improve_existing", targetUrl: "https://example.com/guide", sourceArtifactId: "g" },
    ])).toEqual([expect.objectContaining({ state: "proposed", kind: "improve_existing", targetUrl: "https://example.com/guide", sourceArtifactIds: ["k", "g"] })]);
  });
  it("conflicting existing pages need review rather than two new articles", () => {
    const p = reconcileSeoPageProposals(["/a", "/b"].map(targetUrl => ({ intentKey: "golf", kind: "improve_existing" as const, targetUrl, sourceArtifactId: "g" })));
    expect(p).toHaveLength(1); expect(p[0].state).toBe("needs_review"); expect(p[0].targetUrl).toBeNull();
  });
});
