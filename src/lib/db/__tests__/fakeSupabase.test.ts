import { describe, expect, it } from "vitest";
import { FakeSupabase, migrationSchema } from "./fakeSupabase";

describe("the fake is schema-checked against supabase/migrations", () => {
  it("parses every table the app touches, with 0002/0003/0004 columns and keys", () => {
    const s = migrationSchema();
    expect(Object.keys(s).sort()).toEqual([
      "account_members",
      "account_state_meta",
      "accounts",
      "approvals",
      "billing_events",
      "business_profiles",
      "chat_messages",
      "connectors",
      "goals",
      "plans",
      "receipts",
      "resource_profiles",
      "routine_runs",
      "routine_states",
      "subscriptions",
      "taste_events",
      "team_members",
    ]);
    expect([...s.routine_runs.columns]).toEqual(expect.arrayContaining(["approval_id", "dedup_key", "spec_hash", "snapshot"])); // 0002
    expect([...s.chat_messages.columns]).toEqual(expect.arrayContaining(["thread", "position", "meta"])); // 0003
    expect(s.team_members.columns.has("position")).toBe(true);
    expect(s.approvals.columns.has("client_key")).toBe(true);
    expect(s.subscriptions.primaryKey).toEqual(["account_id"]); // 0004
    expect(s.subscriptions.enums.status).toEqual(new Set(["trialing", "active", "past_due", "canceled", "incomplete", "none"]));
    expect(s.subscriptions.uniques).toEqual(expect.arrayContaining([{ columns: ["stripe_subscription_id"], partialNotNull: "stripe_subscription_id" }]));
    expect(s.billing_events.primaryKey).toEqual(["id"]);
    expect(s.routine_states.primaryKey).toEqual(["account_id", "routine_id"]);
    expect(s.account_members.primaryKey).toEqual(["account_id", "user_id"]);
    expect(s.routine_runs.enums.status).toEqual(new Set(["running", "waiting_approval", "done", "failed", "skipped"]));
    expect(s.chat_messages.enums.thread).toEqual(new Set(["corner", "onboarding", "human"]));
    expect(s.approvals.uniques).toContainEqual({ columns: ["account_id", "client_key"], partialNotNull: "client_key" });
    expect(s.connectors.uniques).toContainEqual({ columns: ["account_id", "platform"] });
  });

  it("rejects unknown tables and columns loudly", async () => {
    const db = new FakeSupabase();
    expect(() => db.from("routine_run")).toThrow(/not defined/);
    await expect(db.from("routine_runs").insert({ id: "r1", account_id: "a", routine_id: "x", version: 1, mode: "live", status: "running", started_at: "t", nope: 1 })).rejects.toThrow(/routine_runs\.nope/);
    expect(() => db.from("receipts").select("payload").eq("kindd", "mutation")).toThrow(/receipts\.kindd/);
    await expect(db.from("routine_runs").select("id, nope")).rejects.toThrow(/routine_runs\.nope/);
  });

  it("enforces inline check enums", async () => {
    const db = new FakeSupabase();
    await expect(db.from("routine_runs").insert({ account_id: "a", routine_id: "x", version: 1, mode: "live", status: "paused", started_at: "t" })).rejects.toThrow(/violates check/);
  });

  it("primary keys, unique indexes, upsert merge and .single() semantics behave like Postgres", async () => {
    const db = new FakeSupabase();
    const row = { account_id: "a", routine_id: "D01-W01", enabled: true, version: 1, draft_spec: null, live_spec: null, updated_at: "t" };
    expect((await db.from("routine_states").insert(row)).error).toBeNull();
    expect((await db.from("routine_states").insert(row)).error?.code).toBe("23505");
    const up = await db.from("routine_states").upsert({ account_id: "a", routine_id: "D01-W01", enabled: false }, { onConflict: "account_id,routine_id" }).select().single();
    expect(up.data).toMatchObject({ enabled: false, version: 1 }); // merge keeps the other columns
    expect((await db.from("routine_states").select("*").eq("routine_id", "zzz").single()).error?.code).toBe("PGRST116");
    expect((await db.from("routine_states").select("*").eq("routine_id", "zzz").maybeSingle()).data).toBeNull();
    expect((await db.from("routine_states").update({ enabled: true }).eq("routine_id", "zzz").select().single()).error?.code).toBe("PGRST116");
    await expect(db.from("goals").upsert({ account_id: "a", category: "x", title: "t" }, { onConflict: "account_id,title" })).rejects.toThrow(/not a unique key/);
  });

  it("order / limit / projection / in / gte / lte", async () => {
    const db = new FakeSupabase();
    for (const [id, t] of [
      ["r1", "2026-09-01T00:00:00.000Z"],
      ["r2", "2026-09-03T00:00:00.000Z"],
      ["r3", "2026-09-02T00:00:00.000Z"],
    ])
      db.seed("routine_runs", [{ id, account_id: "a", routine_id: "x", version: 1, mode: "live", status: "done", started_at: t }]);
    const desc = await db.from("routine_runs").select("id").eq("account_id", "a").order("started_at", { ascending: false }).limit(2);
    expect(desc.data).toEqual([{ id: "r2" }, { id: "r3" }]);
    const win = await db.from("routine_runs").select("id").gte("started_at", "2026-09-02T00:00:00.000Z").lte("started_at", "2026-09-02T00:00:00.000Z");
    expect(win.data).toEqual([{ id: "r3" }]);
    const some = await db.from("routine_runs").select("id").in("id", ["r1", "r3"]).order("id");
    expect(some.data).toEqual([{ id: "r1" }, { id: "r3" }]);
  });
});
