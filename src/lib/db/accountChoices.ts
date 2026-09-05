import { listMemberships } from "./accountState";
import { asDb, isDbConfigured } from "./client";
import { getServerSupabase } from "./server";
import { unwrap, type DbClient } from "./types";

export interface AccountChoice { accountId: string; name: string; role: "owner" | "member" }

/** Display only the verified caller's memberships, under their RLS session. This
 * does not provision accounts, accept invites, import agency roles or expose grants. */
export async function accountChoicesForUser(db: DbClient, userId: string): Promise<AccountChoice[]> {
  const memberships = await listMemberships(db, userId);
  if (!memberships.length) return [];
  const rows = await unwrap<{ id: string; name: string | null }[]>("accounts.choices",
    db.from("accounts").select("id,name").in("id", memberships.map(m => m.accountId)));
  const names = new Map(rows.map(r => [r.id, r.name]));
  return memberships.filter(m => names.has(m.accountId)).map(m => ({ ...m, name: names.get(m.accountId)?.trim() || "Unnamed client" }));
}

export async function accountChoicesForRequest(): Promise<{ choices: AccountChoice[]; error: string | null }> {
  if (!isDbConfigured()) return { choices: [], error: null };
  try {
    const supabase = await getServerSupabase();
    if (!supabase) throw new Error("unavailable");
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error("unauthenticated");
    return { choices: await accountChoicesForUser(asDb(supabase), user.id), error: null };
  } catch {
    return { choices: [], error: "Your client access could not be verified. Reload or sign in again." };
  }
}
