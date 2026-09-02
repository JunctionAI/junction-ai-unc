import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/lib/platform/state";
import { createAccount, ensureAccount, listMemberships, loadAccountState, saveAccountState } from "../accountState";
import { FakeSupabase } from "./fakeSupabase";
import { expectedAfterRoundTrip, pick, richState } from "./fixtures";

let db: FakeSupabase;
beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
});

describe("first sign-in bootstrap", () => {
  it("creates the account + owner membership through the 0003 RPC and seeds it from the client state", async () => {
    const seed = richState();
    const res = await ensureAccount(db, seed, { userId: "user-1" });
    expect(res.created).toBe(true);
    expect(db.rows("accounts")).toEqual([expect.objectContaining({ id: res.accountId, name: "Example Co", currency: "AUD" })]);
    expect(db.rows("account_members")).toEqual([expect.objectContaining({ account_id: res.accountId, user_id: "user-1", role: "owner" })]);
    expect(await listMemberships(db)).toEqual([{ accountId: res.accountId, role: "owner" }]);
    // seeded: a fresh load returns what the client had
    const { state, found } = await loadAccountState(db, res.accountId, initialState);
    expect(found).toBe(true);
    expect(pick(state)).toEqual(pick(expectedAfterRoundTrip(seed)));
  });

  it("second sign-in finds the account and hydrates from the rows instead of the client seed", async () => {
    const first = await ensureAccount(db, richState(), { userId: "user-1" });
    const second = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(second.created).toBe(false);
    expect(second.accountId).toBe(first.accountId);
    expect(second.state.goalTitle).toBe("A$90,000 MRR");
    expect(db.rows("accounts")).toHaveLength(1);
  });

  it("an account that exists but was never saved gets seeded (found=false path)", async () => {
    const accountId = await createAccount(db, { currency: "USD" });
    const res = await ensureAccount(db, { ...initialState, goalTitle: "US$10,000 MRR" }, { userId: "user-1" });
    expect(res).toMatchObject({ accountId, created: false });
    expect((await loadAccountState(db, accountId)).state.goalTitle).toBe("US$10,000 MRR");
  });

  it("the RPC refuses when there is no signed-in user", async () => {
    db.userId = null;
    await expect(createAccount(db)).rejects.toThrow(/not signed in/);
  });
});

describe("beta invites (0009) — attach on first login", () => {
  /** A seeded account the way scripts/seed-beta.ts leaves it: rows saved, no membership, one open invite. */
  async function seeded(email: string, name = "AVGAR Sport") {
    const accountId = db.insertRow("accounts", { name, currency: "NZD" }).id as string;
    await saveAccountState(db, accountId, { ...richState(), goalTitle: "NZ$100,000 monthly revenue" });
    db.seed("beta_invites", [{ account_id: accountId, email, invited_by: "tom", note: "avgar" }]);
    return accountId;
  }

  it("an invited founder's first sign-in lands in the seeded account — hydrated from its rows, not the client seed, and no second account", async () => {
    const seededId = await seeded("heather@example.com");
    db.userEmail = "Heather@Example.com"; // the RPC matches lower-cased
    const res = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(res).toMatchObject({ accountId: seededId, created: false });
    expect(res.state.goalTitle).toBe("NZ$100,000 monthly revenue");
    expect(db.rows("accounts")).toHaveLength(1);
    expect(db.rows("account_members")).toEqual([expect.objectContaining({ account_id: seededId, user_id: "user-1", role: "owner" })]);
    expect(db.rows("beta_invites")[0]).toMatchObject({ accepted_user_id: "user-1", accepted_at: "2026-09-02T09:00:00.000Z" });
    // the RPC ran before any membership lookup / create_account
    const rpcCall = db.calls.findIndex((c) => c.table === "account_members" && c.op === "select");
    expect(rpcCall).toBeGreaterThanOrEqual(0);
    expect(db.callsFor("accounts", "insert")).toHaveLength(0);
  });

  it("a second sign-in is a no-op on the invite (already accepted) and still finds the account", async () => {
    const seededId = await seeded("heather@example.com");
    db.userEmail = "heather@example.com";
    await ensureAccount(db, initialState, { userId: "user-1" });
    const again = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(again.accountId).toBe(seededId);
    expect(db.rows("account_members")).toHaveLength(1);
    expect(db.rows("beta_invites").every((i) => i.accepted_user_id === "user-1")).toBe(true);
  });

  it("the wrong mailbox (no invite for it) gets an empty account as before — and the seeded one is left for a second invite", async () => {
    const seededId = await seeded("heather@example.com");
    db.userEmail = "someone.else@example.com";
    const res = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(res.created).toBe(true);
    expect(res.accountId).not.toBe(seededId);
    expect(db.rows("beta_invites")[0].accepted_at).toBeNull();
    expect(db.rows("account_members")).toEqual([expect.objectContaining({ account_id: res.accountId })]);
    // recovery: a second invite row for that address, then sign in again (after the empty account is deleted by hand)
    db.seed("beta_invites", [{ account_id: seededId, email: "someone.else@example.com", invited_by: "tom" }]);
    db.tables.set("account_members", []);
    const fixed = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(fixed.accountId).toBe(seededId);
  });

  it("an unconfirmed email attaches nothing; two invites for one address attach both (the first one is home)", async () => {
    const a = await seeded("heather@example.com", "AVGAR Sport");
    db.userEmail = null;
    expect((await ensureAccount(db, initialState, { userId: "user-1" })).created).toBe(true);
    db.tables.set("account_members", []);
    const b = db.insertRow("accounts", { name: "Second Co", currency: "NZD" }).id as string;
    db.seed("beta_invites", [{ account_id: b, email: "heather@example.com", role: "member", created_at: "2026-09-02T10:00:00.000Z" }]);
    db.userEmail = "heather@example.com";
    const res = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(res.accountId).toBe(a);
    expect(await listMemberships(db)).toEqual([
      { accountId: a, role: "owner" },
      { accountId: b, role: "member" },
    ]);
  });

  it("a project without 0009 (function not found) is logged, not fatal — sign-in falls through to create_account", async () => {
    // PostgREST's answer for a missing function (the fake wraps a handler throw into { error })
    db.rpcs.accept_beta_invites = () => {
      throw new Error("Could not find the function public.accept_beta_invites without parameters in the schema cache (PGRST202)");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await ensureAccount(db, initialState, { userId: "user-1" });
    expect(res.created).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/accept_beta_invites unavailable/));
    warn.mockRestore();
    // …but a real failure (not signed in) still propagates
    db.rpcs.accept_beta_invites = () => {
      throw new Error("not signed in");
    };
    await expect(ensureAccount(db, initialState, { userId: "user-1" })).rejects.toThrow(/not signed in/);
  });
});

describe("save → load through the (schema-checked) fake", () => {
  it("round-trips every persisted field", async () => {
    const accountId = await createAccount(db);
    const S = richState();
    await saveAccountState(db, accountId, S, { userId: "user-1" });
    const { state } = await loadAccountState(db, accountId, initialState);
    expect(pick(state)).toEqual(pick(expectedAfterRoundTrip(S)));
  });

  it("uses the 0003 upsert keys for every list", async () => {
    const accountId = await createAccount(db);
    await saveAccountState(db, accountId, richState());
    const conflicts = Object.fromEntries(db.calls.filter((c) => c.op === "upsert").map((c) => [c.table, c.onConflict]));
    expect(conflicts).toEqual({
      goals: "account_id,category",
      resource_profiles: "account_id",
      team_members: "account_id,position",
      business_profiles: "account_id",
      routine_states: "account_id,routine_id",
      connectors: "account_id,platform",
      chat_messages: "account_id,thread,position",
      account_state_meta: "account_id",
    });
    expect(db.lastCall("accounts", "update")).toMatchObject({ values: { currency: "AUD" }, filters: [{ kind: "eq", column: "id", value: accountId }] });
  });

  it("saving twice is idempotent (no duplicate rows)", async () => {
    const accountId = await createAccount(db);
    await saveAccountState(db, accountId, richState());
    await saveAccountState(db, accountId, richState());
    expect(db.rows("goals")).toHaveLength(3);
    expect(db.rows("team_members")).toHaveLength(3);
    expect(db.rows("chat_messages")).toHaveLength(7);
    expect(db.rows("plans")).toHaveLength(1);
    expect(db.rows("approvals")).toHaveLength(0);
    expect(db.rows("account_state_meta")).toHaveLength(1);
  });

  it("removing a team member / deselecting a goal category deletes the trailing rows", async () => {
    const accountId = await createAccount(db);
    const S = richState();
    await saveAccountState(db, accountId, S);
    await saveAccountState(db, accountId, { ...S, team: S.team.slice(0, 1), obCats: ["revenue"] });
    expect(db.rows("team_members").map((r) => r.position)).toEqual([0]);
    expect(db.rows("goals").map((r) => r.category)).toEqual(["revenue"]);
    const { state } = await loadAccountState(db, accountId);
    expect(state.team).toHaveLength(1);
    expect(state.obCats).toEqual(["revenue"]);
  });

  it("routine toggles persist without touching the runtime's version / specs", async () => {
    const accountId = await createAccount(db);
    db.seed("routine_states", [{ account_id: accountId, routine_id: "D01-W01", enabled: false, version: 3, live_spec: { id: "D01-W01", version: 3 } }]);
    await saveAccountState(db, accountId, { ...initialState, routineOn: { "Founder content engine": true } });
    const row = db.rows("routine_states").find((r) => r.routine_id === "D01-W01")!;
    expect(row).toMatchObject({ enabled: true, version: 3, live_spec: { id: "D01-W01", version: 3 } });
    expect(db.lastCall("routine_states", "upsert").values).toEqual([{ account_id: accountId, routine_id: "D01-W01", enabled: true }]);
    expect((await loadAccountState(db, accountId)).state.routineOn).toEqual({ "Founder content engine": true });
  });

  it("the demo approval cards are never written for a real account, and the runtime's approvals are never read as them", async () => {
    const accountId = await createAccount(db);
    await saveAccountState(db, accountId, { ...initialState, apStatus: ["approved", "pending", "held"] }, { userId: "user-1" });
    expect(db.rows("approvals")).toHaveLength(0);
    expect(db.callsFor("approvals")).toHaveLength(0);
    // runtime-created approvals (and a legacy demo-ap row from before 2026-09-02) are left alone and not hydrated into apStatus
    db.seed("approvals", [
      { account_id: accountId, title: "Real one", status: "pending" },
      { account_id: accountId, client_key: "demo-ap-0", title: "legacy demo card", status: "approved" },
    ]);
    await saveAccountState(db, accountId, initialState);
    expect(db.rows("approvals")).toHaveLength(2);
    expect((await loadAccountState(db, accountId)).state.apStatus).toEqual(initialState.apStatus);
    expect(db.callsFor("approvals")).toHaveLength(0);
  });

  it("chat messages append in order across saves", async () => {
    const accountId = await createAccount(db);
    const S = { ...initialState, messages: [{ from: "j" as const, text: "one" }] };
    await saveAccountState(db, accountId, S);
    await saveAccountState(db, accountId, { ...S, messages: [...S.messages, { from: "u", text: "two" }, { from: "j", text: "", typing: true }] });
    expect((await loadAccountState(db, accountId)).state.messages).toEqual([
      { from: "j", text: "one" },
      { from: "u", text: "two" },
    ]);
  });

  it("the plan row is updated in place, not duplicated", async () => {
    const accountId = await createAccount(db);
    await saveAccountState(db, accountId, initialState);
    await saveAccountState(db, accountId, { ...initialState, posture: "sales" });
    expect(db.rows("plans")).toHaveLength(1);
    expect(db.rows("plans")[0].title).toBe("Sales-led outbound");
  });

  it("a DB error surfaces as a thrown error naming the table + op", async () => {
    const accountId = await createAccount(db);
    db.seed("goals", [{ account_id: accountId, category: "revenue", tier: "governing", title: "x" }]);
    db.seed("goals", [{ account_id: accountId, category: "brand", tier: "checkpoint", title: "y" }]);
    // force a unique violation on goals by making the fake refuse the upsert key
    const broken = new FakeSupabase({ ...db.schema, goals: { ...db.schema.goals, uniques: [{ columns: ["id"] }] } });
    broken.tables.set("accounts", db.rows("accounts"));
    await expect(saveAccountState(broken, accountId, initialState)).rejects.toThrow(/goals\.upsert|not a unique key/);
  });
});
