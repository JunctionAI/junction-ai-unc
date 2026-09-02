/* SERVER ONLY — imports next/headers through ./server; never import from a client component.

   requireAccountSession(): the one way an API route resolves "who is calling and which
   account is theirs". Used by the approvals routes and by the billing routes (through
   src/lib/billing/server.ts) so every session-bound route answers the same way:

     DB not configured           → 200 { fallback: true }   (demo mode: the UI keeps its demo data)
     no service role             → 503 { error }            (nothing server-side can be written)
     no session                  → 401 { error }
     session, no account         → 403 { error }  — or the account is created when
                                                     `createAccount` is set (billing and the
                                                     Shopify install entry do that: first sign-in
                                                     raced the client bootstrap). Before either,
                                                     an open beta invite for the user's email is
                                                     accepted (0009) so a seeded account wins.

   Returns either the session or the Response to send instead. Reads process.env only. */

import { asDb, isDbConfigured } from "./client";
import { acceptBetaInvites, createAccount, listMemberships } from "./accountState";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "./server";
import type { DbClient } from "./types";

export interface AccountSession {
  userId: string;
  email: string | null;
  accountId: string;
  /** The founder's own client (RLS). */
  db: DbClient;
  /** Service-role client — for the tables no client role may touch. */
  service: DbClient;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function requireAccountSession(opts: { createAccount?: boolean } = {}): Promise<AccountSession | Response> {
  if (!isDbConfigured()) return json({ fallback: true }, 200);
  if (!isServiceRoleConfigured()) return json({ error: "account storage is not configured" }, 503);
  const supabase = await getServerSupabase();
  if (!supabase) return json({ fallback: true }, 200);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign in first" }, 401);
  const db = asDb(supabase);
  let memberships = await listMemberships(db);
  if (!memberships.length) {
    await acceptBetaInvites(db);
    memberships = await listMemberships(db);
  }
  let accountId: string;
  if (memberships.length) accountId = memberships[0].accountId;
  else if (opts.createAccount) accountId = await createAccount(db);
  else return json({ error: "no account for this user" }, 403);
  return { userId: user.id, email: user.email ?? null, accountId, db, service: asDb(getServiceSupabase()) };
}
