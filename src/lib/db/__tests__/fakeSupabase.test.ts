import { describe, expect, it } from "vitest";
import { FakeSupabase, migrationSchema } from "./fakeSupabase";

describe("the fake is schema-checked against supabase/migrations", () => {
  it("parses every table the app touches, with 0002/0003/0004/0005/0006/0007/0009/0010/0012/0013/0014/0015/0016 columns and keys", () => {
    const s = migrationSchema();
    expect(Object.keys(s).sort()).toEqual([
      "account_members",
      "account_model_prefs",
      "account_presets",
      "account_profiles",
      "account_state_meta",
      "accounts",
      "action_ledger",
      "app_errors",
      "approvals",
      "artifacts",
      "benchmark_optins",
      "benchmarks",
      "beta_invites",
      "billing_events",
      "business_profiles",
      "channel_links",
      "channel_secrets",
      "chat_messages",
      "connector_secrets",
      "connectors",
      "daily_briefs",
      "goals",
      "intake_events",
      "intake_keys",
      "kpi_snapshots",
      "llm_usage",
      "memories",
      "n8n_workflows",
      "oauth_states",
      "outbound_messages",
      "plans",
      "playbooks",
      "receipts",
      "resource_profiles",
      "routine_outcomes",
      "routine_params",
      "routine_runs",
      "routine_states",
      "self_reviews",
      "subscriptions",
      "taste_events",
      "team_members",
      "waitlist",
      "worker_heartbeats",
    ]);
    // 0014 launch hardening
    expect(s.accounts.columns.has("monthly_llm_cap_usd")).toBe(true);
    expect([...s.app_errors.columns]).toEqual(expect.arrayContaining(["scope", "message", "stack", "account_id", "context"]));
    expect(s.worker_heartbeats.primaryKey).toEqual(["worker"]);
    // 0016 action idempotency ledger
    expect(s.action_ledger.primaryKey).toEqual(["key"]);
    expect(s.action_ledger.enums.status).toEqual(new Set(["started", "ok", "failed"]));
    expect([...s.action_ledger.columns]).toEqual(expect.arrayContaining(["key", "account_id", "run_id", "action_id", "status", "external_id", "error"]));
    // 0006 telemetry
    expect(s.routine_outcomes.uniques).toContainEqual({ columns: ["account_id", "routine_id", "kpi_key", "window_end"] });
    expect(s.routine_outcomes.enums.kpi_op).toEqual(new Set(["gte", "lte"]));
    expect([...s.routine_outcomes.columns]).toEqual(expect.arrayContaining(["kpi_target", "kpi_actual", "provenance", "window_start", "window_end", "measured_at", "run_id"]));
    expect(s.self_reviews.uniques).toContainEqual({ columns: ["account_id", "week_start"] });
    expect([...s.self_reviews.columns]).toEqual(expect.arrayContaining(["body", "changes", "evidence"]));
    expect(s.benchmarks.primaryKey).toEqual(["metric_key", "segment"]);
    expect([...s.benchmarks.columns]).toEqual(expect.arrayContaining(["p50", "p75", "n", "computed_at"]));
    expect(s.benchmark_optins.primaryKey).toEqual(["account_id"]);
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
    expect(s.routine_runs.enums.status).toEqual(new Set(["running", "waiting_approval", "waiting_input", "done", "failed", "skipped"]));
    expect(s.chat_messages.enums.thread).toEqual(new Set(["corner", "onboarding", "human"]));
    expect(s.approvals.uniques).toContainEqual({ columns: ["account_id", "client_key"], partialNotNull: "client_key" });
    expect(s.connectors.uniques).toContainEqual({ columns: ["account_id", "platform"] });
    expect(s.connectors.columns.has("sync_ref")).toBe(true); // 0005
    expect(s.connector_secrets.primaryKey).toEqual(["connector_id"]);
    expect([...s.connector_secrets.columns]).toEqual(expect.arrayContaining(["ciphertext", "iv", "tag", "key_version"]));
    expect(s.oauth_states.primaryKey).toEqual(["state"]);
    expect([...s.oauth_states.columns]).toEqual(expect.arrayContaining(["account_id", "platform", "code_verifier", "shop", "expires_at"]));
    expect(s.beta_invites.uniques).toContainEqual({ columns: ["email", "account_id"], partialNotNull: undefined }); // 0009
    expect(s.beta_invites.enums.role).toEqual(new Set(["owner", "member"]));
    expect([...s.beta_invites.columns]).toEqual(expect.arrayContaining(["email", "invited_by", "note", "accepted_at", "accepted_user_id"]));
    // 0010 client brain
    expect(s.memories.enums.kind).toEqual(new Set(["fact", "preference", "constraint", "decision", "relationship", "event", "lesson", "summary"]));
    expect(s.memories.enums.source).toEqual(new Set(["chat", "onboarding", "scan", "receipt", "self_review", "intake", "founder", "brief"]));
    expect([...s.memories.columns]).toEqual(expect.arrayContaining(["embedding", "happens_at", "valid_from", "valid_to", "superseded_by", "source_ref", "tags"]));
    expect(s.account_profiles.primaryKey).toEqual(["account_id"]);
    expect([...s.account_profiles.columns]).toEqual(expect.arrayContaining(["tone", "decision_style", "cadence", "channels", "founder_notes"]));
    // 0012 channels: the one thread carries its channel; links / ledger / secrets are keyed and enum-checked
    expect([...s.chat_messages.columns]).toEqual(expect.arrayContaining(["channel", "external_msg_id", "delivery"]));
    expect([...s.chat_messages.enums.channel]).toEqual(["app", "telegram", "whatsapp", "slack", "sms", "email"]);
    expect(s.chat_messages.uniques).toContainEqual({ columns: ["channel", "external_msg_id"], partialNotNull: "external_msg_id" });
    expect(s.channel_links.uniques).toContainEqual({ columns: ["channel", "external_id"] });
    expect(s.channel_links.uniques).toContainEqual({ columns: ["link_code"], partialNotNull: "link_code" });
    expect([...s.outbound_messages.enums.status]).toEqual(["sent", "failed", "queued"]);
    expect(s.channel_secrets.uniques).toContainEqual({ columns: ["channel", "scope_id"] });
    expect(s.kpi_snapshots.uniques).toContainEqual({ columns: ["account_id", "metric_key", "window_end"] });
    expect(s.daily_briefs.uniques).toContainEqual({ columns: ["account_id", "day"] });
    expect(s.intake_keys.uniques).toContainEqual({ columns: ["key_hash"] });
    expect(s.playbooks.uniques).toContainEqual({ columns: ["domain", "title"] });
  });

  it("answers match_memories (0010) with cosine similarity over live embedded memories", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: "a1", name: "x" }]);
    db.seed("memories", [
      { id: "m1", account_id: "a1", kind: "fact", text: "north", source: "chat", embedding: [0, 1], valid_from: "2026-01-01" },
      { id: "m2", account_id: "a1", kind: "fact", text: "east", source: "chat", embedding: [1, 0], valid_from: "2026-01-01" },
      { id: "m3", account_id: "a1", kind: "event", text: "north-east", source: "chat", embedding: [1, 1], valid_from: "2026-01-01" },
      { id: "m4", account_id: "a1", kind: "fact", text: "gone", source: "chat", embedding: [0, 1], valid_from: "2026-01-01", valid_to: "2026-02-01" },
      { id: "m5", account_id: "a1", kind: "fact", text: "no vector", source: "chat", valid_from: "2026-01-01" },
    ]);
    const { data } = await db.rpc("match_memories", { acct: "a1", query_embedding: [0, 1], match_count: 2, kinds: null });
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["m1", "m3"]);
    const onlyEvents = await db.rpc("match_memories", { acct: "a1", query_embedding: [0, 1], match_count: 5, kinds: ["event"] });
    expect((onlyEvents.data as { id: string; similarity: number }[]).map((r) => r.id)).toEqual(["m3"]);
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
