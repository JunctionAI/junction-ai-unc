import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interface";
import { readSavedSeoResults, type SeoResultBinding } from "../seoSavedResults";
import { planSeoPackage } from "../seoPackage";
import { seoPackageReply } from "../seoConversation";

const scope = { accountId: "avgar", contextGeneration: 1, market: "US" as const, cycleId: "cycle" };
const now = "2026-09-06T04:00:00Z";
function fixture() {
  const binding: SeoResultBinding = { ...scope, stepId: "keywords", routineId: "D03-W01", runId: "run", artifactId: "art",
    artifactRevision: 0, specHash: "reviewed", validUntil: "2026-09-07T04:00:00Z", inputs: [] };
  const run = { id: "run", accountId: "avgar", contextGeneration: 1, routineId: "D03-W01", specHash: "reviewed",
    status: "done", mode: "dry_run", finishedAt: "2026-09-06T03:00:00Z" };
  const artifact = { id: "art", runId: "run", accountId: "avgar", routineId: "D03-W01", kind: "keyword_list", revision: 0, status: "draft" };
  const store = { getRun: vi.fn(async () => run), getArtifact: vi.fn(async () => artifact) };
  const read = () => readSavedSeoResults(store as unknown as Store, scope, [binding], now);
  return { binding, run, artifact, store, read };
}
describe("saved SEO results", () => {
  it("reads the saved run and artifact before counting completed work", async () => {
    const { read, store } = fixture();
    const result = await read();
    expect(result.results).toHaveLength(1); expect(result.rejected).toEqual([]);
    expect(store.getRun).toHaveBeenCalledWith("run"); expect(store.getArtifact).toHaveBeenCalledWith("art");
  });
  it.each(["account", "generation", "market", "cycle", "article"])("refuses %s binding before querying", async field => {
    const { binding, read, store } = fixture();
    if (field === "account") binding.accountId = "other";
    if (field === "generation") binding.contextGeneration = 2;
    if (field === "market") binding.market = "AU";
    if (field === "cycle") binding.cycleId = "other";
    if (field === "article") binding.stepId = "articles";
    expect((await read()).results).toEqual([]); expect(store.getRun).not.toHaveBeenCalled();
  });
  it.each(["account", "generation", "status", "mode", "hash", "time"])("refuses saved run mismatch: %s", async field => {
    const { run, read } = fixture();
    if (field === "account") run.accountId = "foreign";
    if (field === "generation") run.contextGeneration = 0;
    if (field === "status") run.status = "running";
    if (field === "mode") run.mode = "live";
    if (field === "hash") run.specHash = "different";
    if (field === "time") run.finishedAt = "2026-09-07T04:00:00Z";
    expect((await read()).results).toEqual([]);
  });
  it.each(["held", "revision", "foreign", "run", "kind"])("refuses changed artifact: %s", async field => {
    const { artifact, read } = fixture();
    if (field === "held") artifact.status = "held";
    if (field === "revision") artifact.revision = 1;
    if (field === "foreign") artifact.accountId = "other";
    if (field === "run") artifact.runId = "other";
    if (field === "kind") artifact.kind = "generic";
    expect((await read()).results).toEqual([]);
  });
  it("does not hide unavailable storage as an empty result", async () => {
    const { store, read } = fixture(); store.getRun.mockRejectedValueOnce(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
  });
  it("connects saved evidence to a conversational partial-progress review", async () => {
    const { read } = fixture();
    const { results } = await read();
    const plan = planSeoPackage({ ...scope, now, results, enabledRoutineIds: ["D03-W01", "D03-W02", "D03-W04"],
      readySteps: ["keywords", "gaps"], prepareArticles: true });
    const reply = seoPackageReply(plan);
    expect(reply).toContain("i've saved keyword research");
    expect(reply).toContain("next up: the page opportunities");
    expect(reply).toContain("not started yet");
    expect(reply).toContain("still waiting: the page title and description drafts, the article drafts");
    expect(reply).not.toContain("D03-"); expect(reply).not.toContain("everything you selected");
  });
  it("speaks plainly when all switches are off", () => {
    const reply = seoPackageReply(planSeoPackage({ ...scope, now, results: [], enabledRoutineIds: [], readySteps: [], prepareArticles: false }));
    expect(reply).toContain("routines are off"); expect(reply).not.toContain("saved");
  });
});
