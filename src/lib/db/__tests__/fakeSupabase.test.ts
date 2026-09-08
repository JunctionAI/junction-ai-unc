import { describe, expect, it } from "vitest";
import { FakeSupabase, migrationSchema } from "./fakeSupabase";

describe("the fake is schema-checked against supabase/migrations", () => {
  it("parses every table the app touches, with 0002/0003/0004/0005/0006/0007/0009/0010/0012/0013/0014/0015/0016 columns and keys", () => {
    const s = migrationSchema();
    expect(Object.keys(s).sort()).toEqual([
      "account_dataset_snapshots",
      "account_members",
      "account_model_prefs",
      "account_presets",
      "account_profiles",
      "account_source_bindings",
      "account_source_dataset_grants",
      "account_state_meta",
      "accounts",
      "action_ledger",
      "app_errors",
      "approvals",
      "artifact_deliveries",
      "artifacts",
      "backend_leases",
      "benchmark_optins",
      "benchmarks",
      "beta_invites",
      "billing_events",
      "business_profiles",
      "channel_inbox",
      "channel_links",
      "channel_secrets",
      "chat_messages",
      "connector_refresh_attempts",
      "connector_secrets",
      "connectors",
      "daily_briefs",
      "goals",
      "grok_control_records",
      "grok_routine_settings",
      "grok_settings_outbox",
      "intake_events",
      "intake_keys",
      "kpi_snapshots",
      "llm_spend_reservations",
      "llm_usage",
      "manual_routine_cancellations",
      "manual_routine_requests",
      "memories",
      "n8n_calendar_bindings",
      "n8n_calendar_runs",
      "n8n_shadow_candidates",
      "n8n_shadow_completions",
      "n8n_shadow_permits",
      "n8n_workflows",
      "oauth_states",
      "ops_account_access",
      "ops_draft_preview_requests",
      "ops_work_reads",
      "outbound_messages",
      "plans",
      "playbooks",
      "receipts",
      "resource_profiles",
      "review_action_approvals",
      "review_action_executions",
      "review_action_reconciliations",
      "review_comments",
      "review_output_versions",
      "review_outputs",
      "review_revision_jobs",
      "routine_commands",
      "routine_outcomes",
      "routine_params",
      "routine_runs",
      "routine_schedule_claims",
      "routine_schedules",
      "routine_states",
      "self_reviews",
      "seo_package_settings",
      "seo_work_packages",
      "subscriptions",
      "taste_events",
      "team_members",
      "waitlist",
      "worker_heartbeats",
    ]);
    expect(s.grok_routine_settings.primaryKey).toEqual(["account_id","routine_id"]);
    expect(s.grok_settings_outbox.uniques).toContainEqual(expect.objectContaining({columns:["account_id","routine_id","revision"]}));
    expect(s.grok_control_records.primaryKey).toEqual(["id"]);
    expect(s.routine_runs.columns.has("scheduling_owner")).toBe(true);
    // 0014 launch hardening
    expect(s.manual_routine_cancellations.primaryKey).toEqual(["account_id","context_generation","actor_id","request_id"]);
    expect(s.ops_account_access.primaryKey).toEqual(["user_id", "account_id"]);
    expect(s.ops_work_reads.primaryKey).toEqual(["id"]);
    expect([...s.ops_work_reads.columns]).toEqual(expect.arrayContaining(["user_id", "account_id", "run_id", "context_generation", "artifact_ids", "receipt_ids", "read_at"]));
    expect([...s.ops_account_access.columns]).toEqual(expect.arrayContaining(["work_read_granted_at", "work_read_granted_by", "work_read_reason"]));
    expect([...s.ops_account_access.columns]).toEqual(expect.arrayContaining(["draft_preview_granted_at", "draft_preview_granted_by", "draft_preview_reason", "draft_preview_expires_at"]));
    expect(s.ops_draft_preview_requests.primaryKey).toEqual(["request_id"]);
    expect([...s.ops_draft_preview_requests.columns]).toEqual(expect.arrayContaining(["user_id", "account_id", "context_generation", "routine_id", "spec_hash", "inputs_hash", "requested_at"]));
    expect([...s.ops_account_access.columns]).toEqual(expect.arrayContaining(["granted_at", "granted_by", "reason", "revoked_at", "expires_at"]));
    expect(s.account_source_bindings.uniques).toContainEqual(expect.objectContaining({ columns: ["source_system", "source_project", "source_kind", "source_key"] }));
    expect([...s.account_source_dataset_grants.columns]).toEqual(expect.arrayContaining(["account_id", "context_generation", "binding_id", "platform", "dataset", "source_contract", "max_source_age_minutes", "revoked_at"]));
    expect(s.n8n_shadow_candidates.primaryKey).toEqual(["permit_id"]);
    expect(s.n8n_shadow_completions.primaryKey).toEqual(["permit_id"]);
    expect([...s.n8n_shadow_candidates.columns]).toEqual(expect.arrayContaining([
      "account_id", "context_generation", "run_id", "run_started_at", "execution_id", "candidate", "recorded_at",
    ]));
    expect(s.n8n_shadow_permits.primaryKey).toEqual(["id"]);
    expect([...s.n8n_shadow_permits.columns]).toEqual(expect.arrayContaining([
      "account_id", "context_generation", "run_id", "registration_id", "authorized_by", "idempotency_key",
      "spec", "contract", "request_digest", "token_digest", "execution_id", "result", "authorized_at", "issuance",
    ]));
    expect(s.n8n_shadow_permits.uniques).toEqual(expect.arrayContaining([
      expect.objectContaining({ columns: ["run_id"] }),
      expect.objectContaining({ columns: ["account_id", "context_generation", "idempotency_key"] }),
    ]));
    expect(s.n8n_shadow_permits.enums.status).toEqual(new Set(["reserved", "dispatching", "provider_authorized", "verifying", "verified", "refused", "uncertain"]));
    expect(s.accounts.columns.has("monthly_llm_cap_usd")).toBe(true);
    expect([...s.app_errors.columns]).toEqual(expect.arrayContaining(["scope", "message", "stack", "account_id", "context"]));
    expect(s.worker_heartbeats.primaryKey).toEqual(["worker"]);
    // 20260903211025 atomic model-spend admission
    expect(s.llm_spend_reservations.primaryKey).toEqual(["id"]);
    expect([...s.llm_spend_reservations.columns]).toEqual(expect.arrayContaining(["account_id", "ceiling_usd", "month_start", "expires_at", "created_at"]));
    // 0016 action idempotency ledger
    expect(s.action_ledger.primaryKey).toEqual(["key"]);
    expect(s.action_ledger.enums.status).toEqual(new Set(["started", "ok", "failed"]));
    expect([...s.action_ledger.columns]).toEqual(expect.arrayContaining(["key", "account_id", "run_id", "action_id", "status", "external_id", "error"]));
    // 0006 telemetry
    expect(s.routine_outcomes.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "routine_id", "kpi_key", "window_end"] }));
    expect(s.routine_outcomes.enums.kpi_op).toEqual(new Set(["gte", "lte"]));
    expect([...s.routine_outcomes.columns]).toEqual(expect.arrayContaining(["kpi_target", "kpi_actual", "provenance", "window_start", "window_end", "measured_at", "run_id"]));
    expect(s.self_reviews.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "week_start"] }));
    expect([...s.self_reviews.columns]).toEqual(expect.arrayContaining(["body", "changes", "evidence"]));
    expect(s.benchmarks.primaryKey).toEqual(["metric_key", "segment"]);
    expect([...s.benchmarks.columns]).toEqual(expect.arrayContaining(["p50", "p75", "n", "computed_at"]));
    expect(s.benchmark_optins.primaryKey).toEqual(["account_id"]);
    expect([...s.routine_runs.columns]).toEqual(expect.arrayContaining(["approval_id", "dedup_key", "spec_hash", "snapshot"])); // 0002
    // Schema-qualified ALTER must extend routine_runs, not invent a "public" table.
    expect(s.routine_runs.columns.has("context_generation")).toBe(true);
    expect(s).not.toHaveProperty("public");
    expect(s.artifacts.columns.has("revision")).toBe(true);
    expect(s.artifact_deliveries.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "context_generation", "user_id", "artifact_id", "artifact_revision", "channel"] }));
    expect([...s.chat_messages.columns]).toEqual(expect.arrayContaining(["thread", "position", "meta"])); // 0003
    expect(s.team_members.columns.has("position")).toBe(true);
    expect(s.approvals.columns.has("client_key")).toBe(true);
    expect(s.subscriptions.primaryKey).toEqual(["account_id"]); // 0004
    expect(s.subscriptions.enums.status).toEqual(new Set(["trialing", "active", "past_due", "canceled", "incomplete", "none"]));
    expect(s.subscriptions.uniques).toContainEqual(expect.objectContaining({ columns: ["stripe_subscription_id"], partialNotNull: "stripe_subscription_id" }));
    expect(s.billing_events.primaryKey).toEqual(["id"]);
    expect(s.routine_states.primaryKey).toEqual(["account_id", "routine_id"]);
    expect(s.account_members.primaryKey).toEqual(["account_id", "user_id"]);
    expect(s.routine_runs.enums.status).toEqual(new Set(["running", "waiting_approval", "waiting_input", "done", "failed", "skipped"]));
    expect(s.chat_messages.enums.thread).toEqual(new Set(["corner", "onboarding", "human"]));
    expect(s.approvals.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "client_key"], partialNotNull: "client_key" }));
    expect(s.connectors.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "platform"] }));
    expect(s.connectors.columns.has("sync_ref")).toBe(true); // 0005
    expect(s.connector_secrets.primaryKey).toEqual(["connector_id"]);
    expect([...s.connector_secrets.columns]).toEqual(expect.arrayContaining(["ciphertext", "iv", "tag", "key_version"]));
    expect(s.oauth_states.primaryKey).toEqual(["state"]);
    expect([...s.oauth_states.columns]).toEqual(expect.arrayContaining(["account_id", "platform", "code_verifier", "shop", "expires_at"]));
    expect(s.beta_invites.uniques).toContainEqual(expect.objectContaining({ columns: ["email", "account_id"] })); // 0009
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
    expect([...s.chat_messages.enums.channel]).toEqual(["app", "telegram", "whatsapp", "slack", "sms", "email", "apple"]);
    expect(s.chat_messages.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "context_generation", "channel", "external_scope", "external_msg_id"], partialNotNull: "external_msg_id" }));
    expect(s.chat_messages.uniques).not.toContainEqual(expect.objectContaining({ columns: ["channel", "external_msg_id"] }));
    expect(s.chat_messages.uniques).not.toContainEqual(expect.objectContaining({ columns: ["account_id", "thread", "position"] }));
    expect(s.channel_links.uniques).toContainEqual(expect.objectContaining({ columns: ["channel", "external_id"] }));
    expect(s.channel_links.uniques).toContainEqual(expect.objectContaining({ columns: ["link_code"], partialNotNull: "link_code" }));
    expect([...s.outbound_messages.enums.status]).toEqual(["queued", "sending", "sent", "failed", "uncertain", "cancelled"]);
    expect(s.channel_secrets.uniques).toContainEqual(expect.objectContaining({ columns: ["channel", "scope_id"] }));
    expect(s.kpi_snapshots.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "context_generation", "metric_key", "window_end"] }));
    expect(s.daily_briefs.uniques).toContainEqual(expect.objectContaining({ columns: ["account_id", "context_generation", "day"] }));
    expect(s.kpi_snapshots.uniques.some(u => u.columns.join() === "account_id,metric_key,window_end")).toBe(false);
    expect(s.daily_briefs.uniques.some(u => u.columns.join() === "account_id,day")).toBe(false);
    expect(s.intake_keys.uniques).toContainEqual({ columns: ["key_hash"] });
    expect(s.playbooks.uniques).toContainEqual(expect.objectContaining({ columns: ["domain", "title"] }));
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

  it("atomically reserves against current-month usage plus active reservations across UTC month rollover, then releases by account", async () => {
    const db = new FakeSupabase();
    db.now = () => "2026-10-01T00:00:00.000Z";
    db.seed("accounts", [{ id: "a1", name: "x", monthly_llm_cap_usd: 1 }]);
    db.seed("llm_usage", [
      { account_id: "a1", task: "chat", provider: "anthropic", model: "m", input_tokens: 1, output_tokens: 1, est_cost_usd: 0.2, latency_ms: 1, stop_reason: "end", created_at: "2026-10-01T00:00:00.000Z" },
      { account_id: "a1", task: "chat", provider: "anthropic", model: "m", input_tokens: 1, output_tokens: 1, est_cost_usd: 9, latency_ms: 1, stop_reason: "end", created_at: "2026-09-30T23:59:59.000Z" },
    ]);
    db.seed("llm_spend_reservations", [
      { id: "active", account_id: "a1", ceiling_usd: 0.3, month_start: "2026-09-01", created_at: "2026-09-30T23:55:00.000Z", expires_at: "2026-10-01T00:05:00.000Z" },
      { id: "expired", account_id: "a1", ceiling_usd: 9, month_start: "2026-09-01", created_at: "2026-09-30T22:00:00.000Z", expires_at: "2026-09-30T23:00:00.000Z" },
    ]);

    const admitted = await db.rpc("reserve_llm_spend", { p_account_id: "a1", p_ceiling_usd: 0.4, p_default_cap_usd: 15 });
    expect(admitted.data).toMatchObject({ ok: true, spent_usd: 0.2, reserved_usd: 0.3, cap_usd: 1 });
    expect((admitted.data as { expires_at: string }).expires_at).toBe("2026-11-01T00:30:00.000Z");
    expect(db.rows("llm_spend_reservations").some((row) => row.id === "expired")).toBe(false);
    const reservationId = (admitted.data as { reservation_id: string }).reservation_id;
    expect((await db.rpc("reserve_llm_spend", { p_account_id: "a1", p_ceiling_usd: 0.2, p_default_cap_usd: 15 })).data).toMatchObject({ ok: false, reason: "budget_exceeded", reserved_usd: 0.7 });
    expect((await db.rpc("release_llm_spend_reservation", { p_account_id: "other", p_reservation_id: reservationId })).error?.message).toContain("account not found");
    expect((await db.rpc("release_llm_spend_reservation", { p_account_id: "a1", p_reservation_id: reservationId })).data).toBe(true);
    expect(db.rows("llm_spend_reservations").some((row) => row.id === reservationId)).toBe(false);
  });

  it("admits only one of two ceilings that cannot fit together", async () => {
    const db = new FakeSupabase();
    db.now = () => "2026-09-04T00:00:00.000Z";
    db.seed("accounts", [{ id: "a1", name: "x", monthly_llm_cap_usd: 1 }]);
    const [first, second] = await Promise.all([
      db.rpc("reserve_llm_spend", { p_account_id: "a1", p_ceiling_usd: 0.75, p_default_cap_usd: 15 }),
      db.rpc("reserve_llm_spend", { p_account_id: "a1", p_ceiling_usd: 0.75, p_default_cap_usd: 15 }),
    ]);
    expect([first.data, second.data].filter((row) => (row as { ok: boolean }).ok)).toHaveLength(1);
    expect([first.data, second.data].filter((row) => !(row as { ok: boolean }).ok)).toHaveLength(1);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
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
