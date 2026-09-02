/* Account state persistence — loads/saves PlatformState through the row mapping in
   mapping.ts. Runs in the browser under RLS (the anon client with the founder's session)
   or on the server; takes the DbClient slice so the unit tests drive it with the fake.

   Save strategy (Phase 2): every section is upserted on its natural key (0003 adds the
   position/thread/client_key keys so this is idempotent — no delete-and-reinsert), trailing
   rows of shrunken lists are deleted. The autosave hook only calls save when the persisted
   projection changed, so the write volume is one batch per 800 ms of edits at most.
   Upgrade path: per-section dirty tracking so a chat message doesn't rewrite the goals. */

import type { PlatformState } from "@/lib/platform/state";
import { rowsToState, stateToRows, type AccountRows, type LoadedRows } from "./mapping";
import { unwrap, type DbClient } from "./types";

export interface Membership {
  accountId: string;
  role: "owner" | "member";
}

/** The accounts the signed-in user belongs to (RLS returns only their own rows). */
export async function listMemberships(db: DbClient): Promise<Membership[]> {
  const rows = await unwrap<{ account_id: string; role: "owner" | "member" }[]>(
    "account_members.select",
    db.from("account_members").select("account_id, role").order("created_at", { ascending: true }),
  );
  return rows.map((r) => ({ accountId: r.account_id, role: r.role }));
}

/** Create an account + owner membership for the signed-in user via the 0003 RPC. */
export async function createAccount(db: DbClient, opts: { name?: string; currency?: string } = {}): Promise<string> {
  const id = await unwrap<string>("rpc.create_account", db.rpc("create_account", { p_name: opts.name ?? "", p_currency: opts.currency ?? "NZD" }));
  if (typeof id !== "string" || !id) throw new Error("rpc.create_account: no account id returned");
  return id;
}

export async function loadAccountRows(db: DbClient, accountId: string): Promise<LoadedRows> {
  const byAccount = (table: string, columns: string) => db.from(table).select(columns).eq("account_id", accountId);
  const [account, goals, resourceProfile, teamMembers, businessProfile, routineStates, connectors, chatMessages, stateMeta] = await Promise.all([
    unwrap<LoadedRows["account"]>("accounts.select", db.from("accounts").select("id, currency").eq("id", accountId).maybeSingle()),
    unwrap<LoadedRows["goals"]>("goals.select", byAccount("goals", "account_id, category, tier, title, baseline, deadline").order("created_at", { ascending: true })),
    unwrap<LoadedRows["resourceProfile"]>(
      "resource_profiles.select",
      byAccount("resource_profiles", "account_id, budget_monthly, hours_weekly, reinvestment, gross_margin_pct, website, socials, skills, known_platforms, postures, breadth").maybeSingle(),
    ),
    unwrap<LoadedRows["teamMembers"]>("team_members.select", byAccount("team_members", "account_id, position, name, role, approves").order("position", { ascending: true })),
    unwrap<LoadedRows["businessProfile"]>("business_profiles.select", byAccount("business_profiles", "account_id, scan_status, profile, scanned_at").maybeSingle()),
    unwrap<LoadedRows["routineStates"]>("routine_states.select", byAccount("routine_states", "account_id, routine_id, enabled")),
    unwrap<LoadedRows["connectors"]>("connectors.select", byAccount("connectors", "account_id, platform, status")),
    unwrap<LoadedRows["chatMessages"]>("chat_messages.select", byAccount("chat_messages", "account_id, thread, position, lane, sender, body, meta").order("position", { ascending: true })),
    unwrap<LoadedRows["stateMeta"]>("account_state_meta.select", byAccount("account_state_meta", "account_id, schema_version, client_state").maybeSingle()),
  ]);
  return { account, goals, resourceProfile, teamMembers, businessProfile, routineStates, connectors, chatMessages, stateMeta };
}

/** { state, found }: found=false means nothing was ever saved for this account (seed it). */
export async function loadAccountState(db: DbClient, accountId: string, base?: PlatformState): Promise<{ state: PlatformState; found: boolean }> {
  const rows = await loadAccountRows(db, accountId);
  return { state: rowsToState(rows, base), found: rows.stateMeta !== null };
}

export async function saveAccountRows(db: DbClient, rows: AccountRows): Promise<void> {
  const accountId = rows.account.id;
  const acct = (table: string) => db.from(table);

  await unwrap("accounts.update", acct("accounts").update({ currency: rows.account.currency }).eq("id", accountId));

  // goals: upsert the selected categories, drop the deselected ones
  await unwrap("goals.upsert", acct("goals").upsert(rows.goals as unknown as Record<string, unknown>[], { onConflict: "account_id,category" }));
  const existing = await unwrap<{ category: string }[]>("goals.select", acct("goals").select("category").eq("account_id", accountId));
  const keep = new Set(rows.goals.map((g) => g.category));
  const stale = existing.map((g) => g.category).filter((c) => !keep.has(c));
  if (stale.length) await unwrap("goals.delete", acct("goals").delete().eq("account_id", accountId).in("category", stale));

  await unwrap("resource_profiles.upsert", acct("resource_profiles").upsert(rows.resourceProfile as unknown as Record<string, unknown>, { onConflict: "account_id" }));

  // team: positions upsert in place; trailing rows beyond the current size go
  if (rows.teamMembers.length) await unwrap("team_members.upsert", acct("team_members").upsert(rows.teamMembers as unknown as Record<string, unknown>[], { onConflict: "account_id,position" }));
  await unwrap("team_members.delete", acct("team_members").delete().eq("account_id", accountId).gte("position", rows.teamMembers.length));

  // plan: one live row per account for now (plans keeps history by design; we update the latest)
  const latest = await unwrap<{ id: string } | null>(
    "plans.select",
    acct("plans").select("id").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  );
  const planRow = { title: rows.plan.title, phases: rows.plan.phases, narrative: rows.plan.narrative };
  if (latest) await unwrap("plans.update", acct("plans").update(planRow).eq("id", latest.id));
  else await unwrap("plans.insert", acct("plans").insert({ account_id: accountId, ...planRow }));

  await unwrap("business_profiles.upsert", acct("business_profiles").upsert(rows.businessProfile as unknown as Record<string, unknown>, { onConflict: "account_id" }));

  // routine_states: only `enabled` — version / draft_spec / live_spec belong to the runtime
  if (rows.routineStates.length)
    await unwrap("routine_states.upsert", acct("routine_states").upsert(rows.routineStates as unknown as Record<string, unknown>[], { onConflict: "account_id,routine_id" }));

  if (rows.connectors.length)
    await unwrap("connectors.upsert", acct("connectors").upsert(rows.connectors as unknown as Record<string, unknown>[], { onConflict: "account_id,platform" }));

  if (rows.chatMessages.length)
    await unwrap("chat_messages.upsert", acct("chat_messages").upsert(rows.chatMessages as unknown as Record<string, unknown>[], { onConflict: "account_id,thread,position" }));

  await unwrap(
    "account_state_meta.upsert",
    acct("account_state_meta").upsert({ ...rows.stateMeta, saved_at: new Date().toISOString() } as unknown as Record<string, unknown>, { onConflict: "account_id" }),
  );
}

export async function saveAccountState(db: DbClient, accountId: string, state: PlatformState, opts: { userId?: string; now?: string } = {}): Promise<void> {
  await saveAccountRows(db, stateToRows(accountId, state, opts));
}

/** Attach any open beta invite for the signed-in user's confirmed email (0009 RPC, runs as the
    user under RLS): the seeded account becomes theirs before anything else looks for a
    membership. Idempotent, safe on every sign-in. Returns the account ids attached now.
    A project that hasn't applied 0009 yet answers "function not found" — that is logged and
    read as "no invites" rather than blocking every sign-in; any other failure propagates. */
export async function acceptBetaInvites(db: DbClient): Promise<string[]> {
  try {
    const ids = await unwrap<unknown>("rpc.accept_beta_invites", db.rpc("accept_beta_invites"));
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/PGRST202|could not find the function|does not exist|not found/i.test(msg)) {
      console.warn(`[accounts] accept_beta_invites unavailable (migration 0009 not applied?): ${msg}`);
      return [];
    }
    throw e;
  }
}

/** First sign-in bootstrap: accept any beta invite, then find the user's account or create one
    and seed it with whatever the client already holds (the onboarding answers), so nothing
    typed before sign-in is lost. Order matters: an invited founder must land in the seeded
    account (found=true → hydrated from its rows, the client seed is NOT written over it),
    never in a fresh empty one. */
export async function ensureAccount(
  db: DbClient,
  seed: PlatformState,
  opts: { userId?: string } = {},
): Promise<{ accountId: string; created: boolean; state: PlatformState }> {
  await acceptBetaInvites(db);
  const memberships = await listMemberships(db);
  if (memberships.length) {
    const accountId = memberships[0].accountId;
    const { state, found } = await loadAccountState(db, accountId, seed);
    if (!found) {
      await saveAccountState(db, accountId, seed, opts);
      return { accountId, created: false, state: seed };
    }
    return { accountId, created: false, state };
  }
  const accountId = await createAccount(db, { name: seed.scan.profile?.name ?? "", currency: seed.currency });
  await saveAccountState(db, accountId, seed, opts);
  return { accountId, created: true, state: seed };
}
