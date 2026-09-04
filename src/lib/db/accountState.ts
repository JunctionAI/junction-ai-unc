/* Account state persistence — loads/saves PlatformState through the row mapping in
   mapping.ts. Runs in the browser under RLS (the anon client with the founder's session)
   or on the server; takes the DbClient slice so the unit tests drive it with the fake.

   Chat: the client owns the app's own turns (channel 'app', positions 0..n). Turns said on a
   channel (Telegram, WhatsApp, Slack, SMS — src/lib/channels/thread.ts) live on the same
   thread with their own channel and a far position band; the loader skips them so the
   autosave never re-saves a channel row. The unified view is GET /api/channels/thread.

   Save strategy (Phase 2): every section is upserted on its natural key (0003 adds the
   position/thread/client_key keys so this is idempotent — no delete-and-reinsert), trailing
   rows of shrunken lists are deleted. The autosave hook only calls save when the persisted
   projection changed, so the write volume is one batch per 800 ms of edits at most.
   Upgrade path: per-section dirty tracking so a chat message doesn't rewrite the goals. */

import type { PlatformState } from "@/lib/platform/state";
import { rowsToState, stateToRows, type AccountRows, type LoadedRows } from "./mapping";
import { unwrap, type DbClient } from "./types";

export type MembershipRole = "owner" | "member";

export interface Membership {
  accountId: string;
  role: MembershipRole;
}

/** The accounts this exact signed-in user belongs to, in the canonical server selection order:
    owned accounts first, then oldest membership. The explicit user filter is required because
    account_members RLS also lets members see peers on the same account. */
export async function listMemberships(db: DbClient, userId: string): Promise<Membership[]> {
  const rows = await unwrap<{ account_id: string; role: "owner" | "member" }[]>(
    "account_members.select",
    db.from("account_members").select("account_id, role").eq("user_id", userId).order("created_at", { ascending: true }),
  );
  return rows.map((r) => ({ accountId: r.account_id, role: r.role })).sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1));
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
    unwrap<LoadedRows["account"]>("accounts.select", db.from("accounts").select("id, currency, name").eq("id", accountId).maybeSingle()),
    unwrap<LoadedRows["goals"]>("goals.select", byAccount("goals", "account_id, category, tier, title, baseline, deadline").order("created_at", { ascending: true })),
    unwrap<LoadedRows["resourceProfile"]>(
      "resource_profiles.select",
      byAccount("resource_profiles", "account_id, budget_monthly, hours_weekly, reinvestment, gross_margin_pct, website, socials, skills, known_platforms, postures, breadth").maybeSingle(),
    ),
    unwrap<LoadedRows["teamMembers"]>("team_members.select", byAccount("team_members", "account_id, position, name, role, approves").order("position", { ascending: true })),
    unwrap<LoadedRows["businessProfile"]>("business_profiles.select", byAccount("business_profiles", "account_id, scan_status, profile, scanned_at").maybeSingle()),
    unwrap<LoadedRows["routineStates"]>("routine_states.select", byAccount("routine_states", "account_id, routine_id, enabled")),
    unwrap<LoadedRows["connectors"]>("connectors.select", byAccount("connectors", "account_id, platform, status")),
    unwrap<LoadedRows["chatMessages"]>("chat_messages.select", byAccount("chat_messages", "account_id, thread, position, lane, sender, body, meta, channel").order("position", { ascending: true })),
    unwrap<LoadedRows["stateMeta"]>("account_state_meta.select", byAccount("account_state_meta", "account_id, schema_version, client_state").maybeSingle()),
  ]);
  // Only the app's own turns hydrate the client (rows before 0012 have no channel yet; the
  // column default is 'app'). Channel turns are read through GET /api/channels/thread.
  const appMessages = chatMessages.filter((m) => {
    const c = (m as { channel?: unknown }).channel;
    return c === null || c === undefined || c === "app";
  });
  return { account, goals, resourceProfile, teamMembers, businessProfile, routineStates, connectors, chatMessages: appMessages, stateMeta };
}

/** { state, found, name }: found=false means nothing was ever saved for this account (seed it). */
export async function loadAccountState(db: DbClient, accountId: string, base?: PlatformState): Promise<{ state: PlatformState; found: boolean; name: string }> {
  const rows = await loadAccountRows(db, accountId);
  return { state: rowsToState(rows, base), found: rows.stateMeta !== null, name: rows.account?.name ?? "" };
}

// ---------- the account's name ----------

/** "avgarsport.com" → "avgarsport.com"; "https://www.avgarsport.com/shop" → "avgarsport.com". */
export function websiteHost(website: string | null | undefined): string | null {
  const t = (website ?? "").trim();
  if (!t) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The account's display name from what is known: the scan's business name, else the website
    host, else the founder's goal text. '' when nothing is known yet (never a placeholder). */
export function accountDisplayName(input: { profileName?: string | null; website?: string | null; goalTitle?: string | null }): string {
  const name = (input.profileName ?? "").trim();
  if (name) return name.slice(0, 120);
  const host = websiteHost(input.website);
  if (host) return host;
  const goal = (input.goalTitle ?? "").trim();
  return goal ? goal.slice(0, 120) : "";
}

/** Name a still-blank account from its own rows (business profile → website → governing goal).
    Idempotent: a named account keeps its name. Returns the name (or null when still unknown). */
export async function ensureAccountName(db: DbClient, accountId: string): Promise<string | null> {
  const acct = await unwrap<{ name: string | null } | null>("accounts.select", db.from("accounts").select("name").eq("id", accountId).maybeSingle());
  const current = (acct?.name ?? "").trim();
  if (current) return current;
  const [bp, rp, goals] = await Promise.all([
    unwrap<{ profile: { name?: unknown } | null } | null>("business_profiles.select", db.from("business_profiles").select("profile").eq("account_id", accountId).maybeSingle()),
    unwrap<{ website: string | null } | null>("resource_profiles.select", db.from("resource_profiles").select("website").eq("account_id", accountId).maybeSingle()),
    unwrap<{ title: string; tier: string }[]>("goals.select", db.from("goals").select("title, tier").eq("account_id", accountId)),
  ]);
  const profileName = bp?.profile && typeof bp.profile === "object" && typeof bp.profile.name === "string" ? bp.profile.name : null;
  const governing = goals.find((g) => g.tier === "governing") ?? goals[0];
  const name = accountDisplayName({ profileName, website: rp?.website ?? null, goalTitle: governing?.title ?? null });
  if (!name) return null;
  await unwrap("accounts.update", db.from("accounts").update({ name }).eq("id", accountId));
  return name;
}

export async function saveAccountRows(db: DbClient, rows: AccountRows, opts: { trustedRuntimeSeed?: boolean } = {}): Promise<void> {
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

  // `routine_states` and `connectors` are deliberately absent here. They are runtime and
  // credential-control tables, written only by their session-bound server APIs with the
  // service role. Client autosave must never be an alternate mutation path for either.
  // The offline beta seeder runs with the service role and may create initial, disconnected
  // rows explicitly; this option is never exposed by saveAccountState/client autosave.
  if (opts.trustedRuntimeSeed) {
    if (rows.routineStates.length)
      await unwrap("routine_states.upsert", acct("routine_states").upsert(rows.routineStates as unknown as Record<string, unknown>[], { onConflict: "account_id,routine_id" }));
    if (rows.connectors.length)
      await unwrap("connectors.upsert", acct("connectors").upsert(rows.connectors as unknown as Record<string, unknown>[], { onConflict: "account_id,platform" }));
  }

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

/** First sign-in bootstrap: accept any beta invite, then find the user's account. Product
    callers never self-provision; `allowCreate` is retained only for local/legacy tests and
    the production migration revokes the RPC from client roles. An invited founder lands in the seeded
    account (found=true → hydrated from its rows, the client seed is NOT written over it),
    never in a fresh empty one. */
export async function ensureAccount(
  db: DbClient,
  seed: PlatformState,
  opts: { userId: string; allowCreate?: boolean },
): Promise<{ accountId: string; created: boolean; state: PlatformState; name: string; role: MembershipRole }> {
  await acceptBetaInvites(db);
  const memberships = await listMemberships(db, opts.userId);
  if (memberships.length) {
    const membership = memberships[0];
    const accountId = membership.accountId;
    const { state, found, name } = await loadAccountState(db, accountId, seed);
    // A member may read the account through RLS but cannot seed or autosave it. Hydrate the
    // honest partial rows over the empty account seed and leave first-write bootstrap to an owner.
    if (!found && membership.role === "owner") {
      await saveAccountState(db, accountId, seed, opts);
      return { accountId, created: false, state: seed, name, role: membership.role };
    }
    return { accountId, created: false, state, name, role: membership.role };
  }
  if (!opts.allowCreate) throw new Error("This address has not been invited to the Unc private beta.");
  const name = accountDisplayName({ profileName: seed.scan.profile?.name ?? null, website: seed.website, goalTitle: seed.goalTitle });
  const accountId = await createAccount(db, { name, currency: seed.currency });
  await saveAccountState(db, accountId, seed, opts);
  return { accountId, created: true, state: seed, name, role: "owner" };
}
