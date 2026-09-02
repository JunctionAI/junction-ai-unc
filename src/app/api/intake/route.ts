/* POST /api/intake — the n8n entry point (docs/N8N-INTAKE.md).

   Auth: `Authorization: Bearer unc_ik_…` — an intake key created at POST /api/intake/keys.
   Body: the IntakePayload (src/lib/intake/schema.ts). Idempotency-Key header: the same key
   on this account replays the earlier outcome without writing again.

     503 { error }   Supabase / service role not configured (there is no demo mode for intake)
     401 { error }   missing, malformed, unknown or revoked key
     429 { error }   per-key rate limit (Retry-After header)
     413 / 400       body too large / not JSON / fails the contract (the error names the field)
     200 { ok, event_id, written: {…counts}, warnings: [], replayed }

   Service role throughout — a key is not a session — but every write is scoped to the key's
   account. No key value or payload ever reaches a log line. */

import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { applyIntake } from "@/lib/intake/apply";
import { authenticateIntakeKey, bearerFromHeader, hashIntakeKey, touchIntakeKey } from "@/lib/intake/keys";
import { checkRateLimit } from "@/lib/intake/rateLimit";
import { MAX_BODY_BYTES, parseIntakePayload } from "@/lib/intake/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number, headers?: Record<string, string>) => Response.json(body, { status, headers });

export async function POST(req: Request) {
  if (!isDbConfigured() || !isServiceRoleConfigured()) return json({ error: "intake is not configured on this deployment" }, 503);

  const presented = bearerFromHeader(req.headers.get("authorization"));
  if (!presented) return json({ error: "missing bearer key" }, 401);

  let service;
  try {
    service = asDb(getServiceSupabase());
  } catch {
    return json({ error: "intake is not configured on this deployment" }, 503);
  }

  let auth;
  try {
    auth = await authenticateIntakeKey(service, presented);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "key lookup failed" }, 500);
  }
  if (!auth) return json({ error: "invalid or revoked key" }, 401);

  const rate = checkRateLimit(auth.keyId);
  if (!rate.allowed) return json({ error: "rate limit — try again shortly" }, 429, { "retry-after": String(rate.retryAfterSec) });

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return json({ error: `body larger than ${MAX_BODY_BYTES} bytes` }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const parsed = parseIntakePayload(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const idem = (req.headers.get("idempotency-key") ?? "").trim();
  const idempotencyKeyHash = idem ? hashIntakeKey(`${auth.accountId}:${idem.slice(0, 200)}`) : null;

  try {
    const outcome = await applyIntake(service, auth.accountId, parsed.payload, { keyId: auth.keyId, idempotencyKeyHash, warnings: parsed.warnings });
    await touchIntakeKey(service, auth.keyId).catch(() => undefined);
    return json(outcome, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "intake failed" }, 500);
  }
}
