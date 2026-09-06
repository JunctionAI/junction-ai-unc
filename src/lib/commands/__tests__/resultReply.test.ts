import { describe, expect, it, vi } from "vitest";
import type { Store } from "../../runtime/store/interface";
import type { RoutineCommand } from "../types";
import { savedResultReply } from "../resultReply";

function fixture() {
  const c = { id: "run", runId: "run", routineId: "D03-W01", contextGeneration: 1,
    actor: { accountId: "account", userId: "owner" } } as RoutineCommand;
  const run = { id: "run", accountId: "account", routineId: "D03-W01", contextGeneration: 1, status: "done", mode: "dry_run" };
  const artifact = { runId: "run", accountId: "account", routineId: "D03-W01", kind: "keyword_list",
    title: "Keywords", items: [{ title: "golf travel case" }, { title: "golf bag for flying" }] };
  const store = { getRun: vi.fn(async () => run), listArtifacts: vi.fn(async () => [artifact]) };
  return { c, run, artifact, store, call: () => savedResultReply(store as unknown as Store, c, "fallback") };
}
describe("saved result summaries", () => {
  it("returns useful facts and a fixed account-scoped link without a model call", async () => {
    const { call, store } = fixture();
    const reply = await call();
    expect(reply).toContain("2 keyword candidates");
    expect(reply).toContain("golf travel case");
    expect(reply).toContain("https://junction-unc.vercel.app/app?account=account");
    expect(reply).toContain("aren't proven winners");
    expect(store.listArtifacts).toHaveBeenCalledWith("account", { runId: "run", contextGeneration: 1, limit: 2 });
  });
  it.each(["account", "generation", "routine", "status", "mode"])("refuses mismatched %s", async field => {
    const { run, call, store } = fixture();
    if (field === "account") run.accountId = "other";
    if (field === "generation") run.contextGeneration = 2;
    if (field === "routine") run.routineId = "D01-W01";
    if (field === "status") run.status = "running";
    if (field === "mode") run.mode = "live";
    expect(await call()).toBe("fallback");
    expect(store.listArtifacts).not.toHaveBeenCalled();
  });
  it("rejects a foreign artifact even if a store adapter returns it", async () => {
    const { artifact, call } = fixture(); artifact.accountId = "other";
    expect(await call()).toBe("fallback");
  });
  it("neutralises links and Slack mentions in provider titles", async () => {
    const { artifact, call } = fixture(); artifact.items = [{ title: "<@U123> https://evil.test <!channel>" }];
    const reply = await call();
    expect(reply).not.toContain("https://evil.test"); expect(reply).not.toContain("<"); expect(reply).not.toContain("@");
  });
  it("uses conversational wording and singular grammar for one keyword", async () => {
    const { artifact, call } = fixture(); artifact.items = [{ title: "golf travel bag" }];
    const reply = await call();
    expect(reply).toContain("i've saved 1 keyword candidate to review");
    expect(reply).not.toContain("1 keyword candidates");
  });
});
