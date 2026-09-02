/* /api/intake/keys — the founder (owner) mints and revokes the keys their n8n workflows use.

   GET            → { keys: [{ id, label, createdAt, lastUsedAt, revokedAt }] }   (hashes never leave the server)
   POST { label } → { key: "unc_ik_…", summary }                                   plaintext, shown ONCE
   DELETE { id }  → { ok: true }                                                    revoke (row kept, revoked_at set)
   or { fallback: true } in demo mode · 401 / 403 / 503 { error } — the requireAccountSession contract.

   Owner-only: members can see the key list but cannot mint or revoke. Writes go through the
   service role because intake_keys has a read-only member policy (0010). */

import { requireAccountSession, type AccountSession } from "@/lib/db/session";
import { unwrap } from "@/lib/db/types";
import { createIntakeKey, listIntakeKeys, revokeIntakeKey } from "@/lib/intake/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status });

async function isOwner(session: AccountSession): Promise<boolean> {
  const row = await unwrap<{ role: string } | null>("account_members.role", session.db.from("account_members").select("role").eq("account_id", session.accountId).eq("user_id", session.userId).maybeSingle());
  return row?.role === "owner";
}

export async function GET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    return json({ keys: await listIntakeKeys(session.db, session.accountId) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "key list failed" }, 500);
  }
}

export async function POST(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  let body: { label?: unknown } = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const label = typeof body.label === "string" ? body.label : "n8n";
  try {
    if (!(await isOwner(session))) return json({ error: "only the account owner can create intake keys" }, 403);
    const { key, summary } = await createIntakeKey(session.service, session.accountId, label);
    return json({ key, summary, note: "Store this now — it is not shown again." }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "key creation failed" }, 500);
  }
}

export async function DELETE(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.id !== "string" || !body.id) return json({ error: "id required" }, 400);
  try {
    if (!(await isOwner(session))) return json({ error: "only the account owner can revoke intake keys" }, 403);
    const done = await revokeIntakeKey(session.service, session.accountId, body.id);
    if (!done) return json({ error: "no live key with that id on this account" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "revoke failed" }, 500);
  }
}
