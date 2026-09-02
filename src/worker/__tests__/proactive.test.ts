/* The proactive layer inside the loop: the kpi_snapshot job at its UTC slot, the daily brief
   at 06:30 in each account's own timezone (per-account markers on the heartbeat, restart-safe,
   and the daily_briefs row as the durable dedup), the CLI flags, and demo mode doing nothing. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";
import { clock } from "../../lib/runtime/__tests__/helpers";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { StaticAccountsSource, type WorkerAccount } from "../accounts";
import { parseArgs } from "../cli";
import { FixtureCredentialProvider } from "../credentials";
import { BRIEF_HOUR_LOCAL, BRIEF_MINUTE_LOCAL, dueBriefs, sanitiseBriefMarkers, SCHEDULED_JOBS } from "../jobs";
import { createLogger, memorySink } from "../log";
import { readHeartbeatFile, Worker, type WorkerDeps } from "../loop";
import { runDailyBrief, runKpiSnapshot } from "../telemetry";

const ACCT_ID = "00000000-0000-4000-8000-00000000acc1";
const ACCT: WorkerAccount = { account: { accountId: ACCT_ID, currency: "NZD", budgetMonthly: 3000, approver: "Tom" } };
const H = 3_600_000;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "unc-proactive-"));
  tmpDirs.push(d);
  return d;
}

function harness(startAt: string, extra: Partial<WorkerDeps> = {}) {
  const clk = clock(startAt);
  const store = new MemoryStore();
  const { sink, entries } = memorySink();
  const deps: WorkerDeps = { store, accounts: new StaticAccountsSource([ACCT]), credentials: new FixtureCredentialProvider(), llm: null, now: clk.now, log: createLogger(sink, {}, clk.now), ...extra };
  return { clk, store, deps, entries };
}

function seededDb(timezone: string | null = "Pacific/Auckland") {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: ACCT_ID, name: "Example", currency: "NZD" }]);
  if (timezone) db.seed("account_profiles", [{ account_id: ACCT_ID, cadence: { timezone } }]);
  db.seed("connectors", [{ account_id: ACCT_ID, platform: "shopify", status: "connected" }]);
  return db;
}

describe("schedule (pure)", () => {
  it("kpi_snapshot is the first UTC job, daily 01:30; the brief slot is 06:30 local", () => {
    expect(SCHEDULED_JOBS[0]).toEqual({ id: "kpi_snapshot", cron: "30 1 * * *", flag: "--kpi-snapshot" });
    expect(BRIEF_HOUR_LOCAL).toBe(6);
    expect(BRIEF_MINUTE_LOCAL).toBe(30);
    expect(parseArgs(["--kpi-snapshot", "--daily-brief"])).toMatchObject({ kpiSnapshot: true, dailyBrief: true });
  });

  it("dueBriefs: each account's own 06:30, inside the look-back, not yet served today", () => {
    const nz = { accountId: "nz", timezone: "Pacific/Auckland" };
    const utc = { accountId: "utc", timezone: null };
    const la = { accountId: "la", timezone: "America/Los_Angeles" };
    // 18:31 UTC Wed 2 Sep = 06:31 Thu 3 Sep NZ → nz due for its day 2026-09-03; UTC's 06:30 was 12 h ago (outside 6 h); LA's is at 13:30 UTC — 5 h ago, still inside
    const now = new Date("2026-09-02T18:31:00.000Z");
    expect(dueBriefs(now, [nz, utc, la], {}).map((d) => [d.accountId, d.day, d.slot.toISOString()])).toEqual([
      ["nz", "2026-09-03", "2026-09-02T18:30:00.000Z"],
      ["la", "2026-09-02", "2026-09-02T13:30:00.000Z"],
    ]);
    // a marker for that local day clears it; yesterday's marker does not
    expect(dueBriefs(now, [nz], { nz: { day: "2026-09-03", ranAt: "x", ok: false } })).toEqual([]);
    expect(dueBriefs(now, [nz], { nz: { day: "2026-09-02", ranAt: "x", ok: true } })).toHaveLength(1);
    // before the slot: not yet
    expect(dueBriefs(new Date("2026-09-02T18:29:00.000Z"), [nz], {})).toEqual([]);
    // 06:31 UTC → the UTC account is due; NZ's slot for its day (18:30 the previous UTC day) is 12 h gone
    expect(dueBriefs(new Date("2026-09-02T06:31:00.000Z"), [nz, utc], {}).map((d) => d.accountId)).toEqual(["utc"]);
    // a shorter look-back
    expect(dueBriefs(now, [la], {}, 2 * H)).toEqual([]);
  });

  it("sanitiseBriefMarkers keeps only well-formed per-account markers", () => {
    expect(sanitiseBriefMarkers(undefined)).toEqual({});
    expect(sanitiseBriefMarkers({ a: { day: "2026-09-03", ranAt: "2026-09-02T18:31:00.000Z", ok: true }, b: { day: "nope" }, c: "junk" })).toEqual({ a: { day: "2026-09-03", ranAt: "2026-09-02T18:31:00.000Z", ok: true } });
  });
});

describe("the daily brief in the loop", () => {
  it("runs at 06:30 account-local, once per local day, survives a restart via the heartbeat, and the DB row dedups a fresh machine", async () => {
    const db = seededDb("Pacific/Auckland");
    const { clk, deps, entries } = harness("2026-09-02T18:31:00.000Z", { db }); // 06:31 NZ, Thu 3 Sep
    const dir = tmp();
    const hbPath = join(dir, "heartbeat.json");
    const w1 = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false, jobs: false });

    const first = await w1.tick();
    expect(first.briefs).toEqual([ACCT_ID]);
    expect(w1.stats.briefs[ACCT_ID]).toMatchObject({ day: "2026-09-03", ranAt: "2026-09-02T18:31:00.000Z", ok: true });
    expect(db.rows("daily_briefs")).toHaveLength(1);
    expect(db.rows("daily_briefs")[0]).toMatchObject({ account_id: ACCT_ID, day: "2026-09-03" });
    expect(entries.find((e) => e.event === "job.start")).toMatchObject({ job: "daily_brief", accountId: ACCT_ID, day: "2026-09-03", timezone: "Pacific/Auckland" });
    // taste refresh wrote decision_style (jsonb merge; the cadence key survived)
    expect(db.rows("account_profiles")[0].cadence).toEqual({ timezone: "Pacific/Auckland" });
    expect(db.rows("account_profiles")[0].decision_style).toMatchObject({ decided: 0, risk_appetite: "unknown" });
    expect(readHeartbeatFile(hbPath)?.briefs?.[ACCT_ID]?.day).toBe("2026-09-03");

    clk.advanceHours(1 / 60);
    expect((await w1.tick()).briefs).toEqual([]);
    clk.advanceHours(5);
    expect((await w1.tick()).briefs).toEqual([]);

    // restart inside the look-back: markers reload from the heartbeat, no second run
    const w2 = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false, jobs: false });
    expect(w2.stats.briefs[ACCT_ID]?.day).toBe("2026-09-03");
    expect((await w2.tick()).briefs).toEqual([]);
    expect(entries.filter((e) => e.event === "job.start")).toHaveLength(1);

    // a fresh machine (no heartbeat) at 07:00 NZ re-runs the job — the DB row makes it a no-op
    const w3 = new Worker(deps, { intervalSec: 60, heartbeatPath: join(dir, "elsewhere.json"), handleSignals: false, jobs: false });
    clk.advanceHours(-5 + 29 / 60);
    const fresh = await w3.tick();
    expect(fresh.briefs).toEqual([ACCT_ID]);
    expect(db.rows("daily_briefs")).toHaveLength(1);
    expect(entries.filter((e) => e.event === "job.finish").pop()).toMatchObject({ job: "daily_brief", written: 0, alreadyDone: 1 });

    // the next local day → a new row
    clk.advanceHours(24);
    const w4 = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false, jobs: false });
    expect((await w4.tick()).briefs).toEqual([ACCT_ID]);
    expect(db.rows("daily_briefs").map((r) => r.day)).toEqual(["2026-09-03", "2026-09-04"]);
  });

  it("no timezone → 06:30 UTC; no DB → never; briefs can be switched off", async () => {
    const db = seededDb(null);
    const { clk, deps } = harness("2026-09-02T06:30:30.000Z", { db });
    const w = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, jobs: false });
    expect((await w.tick()).briefs).toEqual([ACCT_ID]);
    expect(db.rows("daily_briefs")[0].day).toBe("2026-09-02");
    clk.advanceHours(1);
    expect((await w.tick()).briefs).toEqual([]);

    const demo = harness("2026-09-02T06:30:30.000Z");
    const d = new Worker(demo.deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false });
    expect((await d.tick()).briefs).toEqual([]);
    expect(d.stats.briefs).toEqual({});

    const off = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, briefs: false });
    expect((await off.tick()).briefs).toEqual([]);
  });

  it("a failing brief is marked served for that day and tried again tomorrow, not every minute", async () => {
    const db = seededDb("UTC");
    const broken = Object.assign(Object.create(db), {
      from: (table: string) => {
        if (table === "daily_briefs") throw new Error("pool exhausted");
        return db.from(table);
      },
    }) as FakeSupabase;
    const { clk, deps, entries } = harness("2026-09-02T06:31:00.000Z", { db: broken });
    const w = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, jobs: false });
    expect((await w.tick()).briefs).toEqual([ACCT_ID]);
    expect(w.stats.briefs[ACCT_ID]).toMatchObject({ day: "2026-09-02", ok: false, error: "pool exhausted" });
    expect(entries.find((e) => e.event === "job.error")).toMatchObject({ job: "daily_brief", error: "pool exhausted" });
    clk.advanceHours(1 / 60);
    expect((await w.tick()).briefs).toEqual([]);
  });
});

describe("the kpi_snapshot job", () => {
  it("runs at 01:30 UTC inside the tick against connected platforms (fixture credentials → fixture provenance)", async () => {
    const db = seededDb();
    const { clk, deps } = harness("2026-09-02T01:30:30.000Z", { db });
    const w = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, briefs: false });
    const report = await w.tick();
    expect(report.jobs).toEqual(["kpi_snapshot"]);
    expect(w.stats.jobs.kpi_snapshot).toMatchObject({ lastSlot: "2026-09-02T01:30:00.000Z", ok: true });
    const rows = db.rows("kpi_snapshots");
    expect(rows.map((r) => r.metric_key).sort()).toEqual(["aov_28d", "orders_7d", "repeat_rate_90d", "revenue_28d", "revenue_7d"]);
    expect(new Set(rows.map((r) => r.provenance))).toEqual(new Set(["fixture"]));
    expect(rows.every((r) => r.window_end === "2026-09-02")).toBe(true);
    clk.advanceHours(1 / 60);
    expect((await w.tick()).jobs).toEqual([]);
  });

  it("the one-shots: --kpi-snapshot per connected account, --daily-brief per account; both skip without a DB", async () => {
    const db = seededDb("Pacific/Auckland");
    const { deps } = harness("2026-09-02T18:31:00.000Z", { db });
    const w = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false });
    const telemetry = { store: deps.store, accounts: deps.accounts, reader: w.adapters.reader, db, now: deps.now, log: deps.log };
    const k = await runKpiSnapshot(telemetry);
    expect(k).toMatchObject({ accounts: 1, written: 5, couldntAsk: 0, skipped: false });
    const b = await runDailyBrief(telemetry);
    expect(b).toMatchObject({ accounts: 1, alreadyDone: [], skipped: false });
    expect(b.written).toEqual([{ accountId: ACCT_ID, day: "2026-09-03", author: "deterministic", items: 0 }]);
    expect((await runDailyBrief(telemetry)).alreadyDone).toEqual([ACCT_ID]);
    expect((await runDailyBrief(telemetry, { force: true })).written).toHaveLength(1);

    const demo = { ...telemetry, db: null };
    expect((await runKpiSnapshot(demo)).skipped).toBe(true);
    expect((await runDailyBrief(demo)).skipped).toBe(true);
    expect(db.rows("daily_briefs")).toHaveLength(1);
  });
});
