/* The health report behind GET /api/health — pure given its deps, so the route is one line
   and the test runs against the schema-checked fake. Relative imports only. */

import type { DbClient } from "../db/types";

export const WORKER_NAME = "unc";
export const WORKER_INTERVAL_ENV = "UNC_WORKER_INTERVAL_SEC";
export const WORKER_FRESH_MULTIPLIER = 3;

export interface HealthDeps {
  /** Service-role client; null = database not configured (demo mode). */
  db: DbClient | null;
  env: Record<string, string | undefined>;
  version: string;
  now?: () => Date;
}

export interface HealthReport {
  ok: boolean;
  build: { sha: string | null; version: string };
  db: { configured: boolean; ok: boolean; ms: number | null; error?: string };
  worker: { lastSeenAt: string | null; ageSec: number | null; fresh: boolean; ticks: number | null; stopping: boolean; lastError: string | null } | null;
  time: string;
}

export function workerMaxAgeMs(env: Record<string, string | undefined>): number {
  const sec = Number((env[WORKER_INTERVAL_ENV] ?? "").trim()) || 60;
  return sec * 1000 * WORKER_FRESH_MULTIPLIER;
}

export function buildSha(env: Record<string, string | undefined>): string | null {
  // UNC_BUILD_SHA is the immutable image/source marker supplied by our release
  // pipeline. Prefer it when present; Vercel's Git metadata can point at the
  // connected branch rather than the exact source uploaded for a controlled release.
  for (const candidate of [env.UNC_BUILD_SHA, env.VERCEL_GIT_COMMIT_SHA]) {
    const value = (candidate ?? "").trim();
    if (/^[0-9a-f]{7,64}$/i.test(value)) return value.slice(0, 12).toLowerCase();
  }
  return null;
}

export async function healthReport(deps: HealthDeps): Promise<HealthReport> {
  const now = (deps.now ?? (() => new Date()))();
  const sha = buildSha(deps.env);
  const report: HealthReport = { ok: true, build: { sha, version: deps.version }, db: { configured: !!deps.db, ok: !deps.db, ms: null }, worker: null, time: now.toISOString() };
  if (!deps.db) return report;
  const t0 = Date.now();
  try {
    const { error } = await deps.db.from("accounts").select("id").limit(1);
    report.db.ms = Date.now() - t0;
    if (error) {
      report.db.ok = false;
      report.db.error = error.message.slice(0, 200);
      report.ok = false;
    } else report.db.ok = true;
  } catch (err) {
    report.db.ms = Date.now() - t0;
    report.db.ok = false;
    report.db.error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    report.ok = false;
  }
  try {
    const { data } = await deps.db.from("worker_heartbeats").select("last_tick_at, started_at, ticks, stopping, last_error").eq("worker", WORKER_NAME).maybeSingle();
    const row = (data ?? null) as { last_tick_at: string | null; started_at: string | null; ticks: number | null; stopping: boolean | null; last_error: string | null } | null;
    if (row) {
      const seen = row.last_tick_at ?? row.started_at;
      const ageSec = seen ? Math.max(0, Math.round((now.getTime() - new Date(seen).getTime()) / 1000)) : null;
      report.worker = { lastSeenAt: seen, ageSec, fresh: ageSec !== null && !row.stopping && ageSec * 1000 <= workerMaxAgeMs(deps.env), ticks: row.ticks ?? null, stopping: !!row.stopping, lastError: row.last_error ?? null };
    }
  } catch {
    report.worker = null;
  }
  return report;
}
