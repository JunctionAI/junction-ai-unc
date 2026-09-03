/* SERVER ONLY — imports next/headers through ./server; never import from a client component.

   requireAccountSession(): the one way an API route resolves "who is calling and which
   account is theirs". Used by the approvals routes and by the billing routes (through
   src/lib/billing/server.ts) so every session-bound route answers the same way:

     DB not configured           → 200 { fallback: true }   (demo mode: the UI keeps its demo data)
     no service role             → 503 { error }            (nothing server-side can be written)
     no session                  → 401 { error }
     session, no account         → 403 { error }. Before that response, an open beta invite
                                   for the user's confirmed email is accepted (0009).

   Returns either the session or the Response to send instead. Reads process.env only. */

import { asDb, isDbConfigured } from "./client";
import { acceptBetaInvites, listMemberships } from "./accountState";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "./server";
import type { DbClient } from "./types";

export interface AccountSession {
  userId: string;
  email: string | null;
  accountId: string;
  /** Server-resolved membership role. Never derive authorization from client state. */
  role: "owner" | "member";
  /** The founder's own client (RLS). */
  db: DbClient;
  /** Service-role client — for the tables no client role may touch. */
  service: DbClient;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function requireAccountSession(): Promise<AccountSession | Response> {
  if (!isDbConfigured()) return json({ fallback: true }, 200);
  if (!isServiceRoleConfigured()) return json({ error: "account storage is not configured" }, 503);
  const supabase = await getServerSupabase();
  if (!supabase) return json({ fallback: true }, 200);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign in first" }, 401);
  const db = asDb(supabase);
  let memberships = await listMemberships(db, user.id);
  if (!memberships.length) {
    await acceptBetaInvites(db);
    memberships = await listMemberships(db, user.id);
  }
  if (!memberships.length) return json({ error: "this address has not been invited to the private beta", code: "invite_required" }, 403);
  const accountId = memberships[0].accountId;
  const role = memberships[0].role;
  return { userId: user.id, email: user.email ?? null, accountId, role, db, service: asDb(getServiceSupabase()) };
}

/** Sensitive account actions are owner-only in private beta. This check is intentionally
    server-side: hiding the control in React is only a usability affordance. */
export async function requireAccountOwnerSession(): Promise<AccountSession | Response> {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  if (session.role !== "owner") return json({ error: "only the account owner can do that", code: "owner_only" }, 403);
  return session;
}
