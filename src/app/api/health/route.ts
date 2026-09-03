/* GET /api/health — is the app up, is the database reachable, when was the worker last seen.

   → 200 { ok: true, build: { sha, version }, db: { configured, ok, ms }, worker: { lastSeenAt, ageSec, fresh, ticks, stopping } | null, time }
     503 (same body, ok: false) when the database is configured but cannot be reached.

   No session (a probe hits it). Nothing from the request is echoed; nothing secret is in the
   body — the build sha comes from VERCEL_GIT_COMMIT_SHA (else package.json's version). The
   worker line reads worker_heartbeats (migration 0014), which the loop upserts every tick;
   "fresh" = seen within 3 × UNC_WORKER_INTERVAL_SEC (default 60 s). */

import pkg from "../../../../package.json";
import { withErrorCapture } from "@/lib/observability/errors";
import { healthReport, type HealthDeps } from "@/lib/observability/health";
import { serviceDb } from "@/worker/wiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  const deps: HealthDeps = { db: serviceDb(), env: process.env, version: pkg.version };
  const report = await healthReport(deps);
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}

export const GET = withErrorCapture("api/health", handleGET);
