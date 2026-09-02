/* GET /api/telemetry/home — what Home reads in DB mode from the improvement loops:
     { review, segment, bar: [{ metricKey, benchmark | null, own }], automation }
   or { fallback: true }   demo mode (no database) — Home keeps its demo values
   or 401 | 403 | 503 { error }

   Session-bound: always the caller's own account. Benchmarks are anonymised aggregates
   (n ≥ 5) readable by any signed-in user; the account's own values come from its own
   routine_outcomes; hours saved from its own runs. */

import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { homeTelemetryForAccount } from "@/lib/telemetry/home";
import { segmentsForAccount } from "@/lib/telemetry/segments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    let segments: string[] = [];
    try {
      segments = await segmentsForAccount(session.service, session.accountId);
    } catch {
      segments = []; // "all" is always a valid segment; never fail Home over a segment lookup
    }
    return Response.json(await homeTelemetryForAccount(getStore(), session.accountId, { segments }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "telemetry failed" }, { status: 500 });
  }
}
