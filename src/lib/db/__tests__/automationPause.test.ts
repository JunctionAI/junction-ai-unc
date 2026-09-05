import { describe, expect, it } from "vitest";
import { automationPauseResponse } from "../automationPause";
import { FakeSupabase } from "./fakeSupabase";
import { accountInitialState } from "../../platform/state";
import { rowsToState, stateToRows, persistedProjection } from "../mapping";
import { DbAccountsSource } from "../../../worker/accounts";
import { resolveAccount } from "../../../worker/service";
import { MemoryStore } from "../../runtime/store/memory";

describe("account automation pause", () => {
  it("unknown resources stay null across hydration/save and cannot recreate a cleared plan", () => {
    const seed = accountInitialState("NZD");
    const rows = stateToRows("held", seed);
    expect(rows.resourceProfile).toMatchObject({ budget_monthly: null, hours_weekly: null });
    expect(rows.plan).toMatchObject({ title: "", phases: [], narrative: null });
    const hydrated = rowsToState({ ...rows, resourceProfile: rows.resourceProfile }, { ...seed, obAnswered: { budget: true, hours: true, target: true } });
    expect(hydrated.obAnswered).toMatchObject({ budget: false, hours: false });
    expect(stateToRows("held", hydrated).resourceProfile.budget_monthly).toBeNull();
    expect(stateToRows("held", { ...hydrated, obAnswered: { budget: true, hours: true, target: false } }).resourceProfile.budget_monthly).toBe(0);
  });
  it("is account-scoped, fails closed on missing data and remains server-owned", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: "held", automation_paused: true }, { id: "ready", automation_paused: false }]);
    expect(await (await automationPauseResponse(db, "held"))!.json()).toMatchObject({ code: "automation_paused" });
    expect(await automationPauseResponse(db, "ready")).toBeNull();
    expect((await automationPauseResponse(db, "missing"))!.status).toBe(503);
    const seed = accountInitialState("NZD");
    const rows = stateToRows("held", seed);
    const state = rowsToState({ ...rows, account: { ...rows.account, automation_paused: true } }, seed);
    expect(state.automationPaused).toBe(true);
    expect(persistedProjection(state)).toBe(persistedProjection({ ...state, automationPaused: false }));
    expect(JSON.stringify(stateToRows("held", state))).not.toContain("automation_paused");
  });

  it("excludes held accounts from scheduling and blocks manual fallback resolution", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: "held", automation_paused: true }, { id: "ready", automation_paused: false }]);
    db.seed("routine_states", [
      { account_id: "held", routine_id: "D01-W01", enabled: true },
      { account_id: "ready", routine_id: "D01-W01", enabled: true },
    ]);
    const accounts = new DbAccountsSource(db);
    expect((await accounts.listAccounts()).map(a => a.account.accountId)).toEqual(["ready"]);
    await expect(resolveAccount({ accounts, store: new MemoryStore() }, "held", { currency: "NZD", budgetMonthly: 1 })).rejects.toThrow("paused");
    expect((await accounts.getAccount("held"))?.automationPaused).toBe(true);
  });
});
