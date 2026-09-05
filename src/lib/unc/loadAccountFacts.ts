/* Shared account-scoped reads for browser chrome and server chat. No browser runtime,
   credentials or provider calls. Errors propagate so consumers cannot invent account facts. */
import { unwrap, type DbClient } from "../db/types";
import { CONNECTOR_PLATFORMS, type PlanPhaseJson } from "../db/mapping";
import { ALL_SYSTEMS } from "../platform/catalog";
import type { AccountFacts, ApprovalFact, ConnectorStatus } from "./accountFacts";

const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));
const NAME_BY_ROUTINE: Record<string, string> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, s.name]));

export async function loadAccountFacts(client: DbClient, accountId: string): Promise<AccountFacts> {
  const by = (table: string, columns: string) => client.from(table).select(columns).eq("account_id", accountId);
  type ConnRow = { platform: string; status: ConnectorStatus; last_sync_at: string | null; last_sync_result: string | null };
  type RsRow = { routine_id: string; enabled: boolean };
  type PlanRow = { title: string; phases: PlanPhaseJson[]; agreed_at: string | null } | null;
  type RpRow = { budget_monthly: number | string; hours_weekly: number | string; skills: string[] | null; postures: string[] | null } | null;
  type ApRow = { id: string; routine_id: string | null; title: string; detail: string | null; before_state: string | null; after_state: string | null; reasoning: string | null; status: ApprovalFact["status"]; expires_at: string | null; decided_at: string | null };
  type RunRow = { id: string; routine_id: string; mode: "live" | "dry_run"; status: string; started_at: string };
  type RcRow = { id: string; kind: string; description: string; created_at: string };
  const [conns, rs, plan, rp, aps, runs, rcs] = await Promise.all([
    unwrap<ConnRow[]>("connectors.select", by("connectors", "platform, status, last_sync_at, last_sync_result")),
    unwrap<RsRow[]>("routine_states.select", by("routine_states", "routine_id, enabled")),
    unwrap<PlanRow>("plans.select", by("plans", "title, phases, agreed_at").order("created_at", { ascending: false }).limit(1).maybeSingle()),
    unwrap<RpRow>("resource_profiles.select", by("resource_profiles", "budget_monthly, hours_weekly, skills, postures").maybeSingle()),
    unwrap<ApRow[]>("approvals.select", by("approvals", "id, routine_id, title, detail, before_state, after_state, reasoning, status, expires_at, decided_at").order("created_at", { ascending: false }).limit(40)),
    unwrap<RunRow[]>("routine_runs.select", by("routine_runs", "id, routine_id, mode, status, started_at").order("started_at", { ascending: false }).limit(50)),
    unwrap<RcRow[]>("receipts.select", by("receipts", "id, kind, description, created_at").order("created_at", { ascending: false }).limit(10)),
  ]);
  const approvals = (aps ?? []).map<ApprovalFact>((a) => ({
    id: a.id,
    routineId: a.routine_id,
    title: a.title,
    detail: a.detail ?? "",
    before: a.before_state ?? "",
    after: a.after_state ?? "",
    reasoning: a.reasoning ?? "",
    status: a.status,
    expiresAt: a.expires_at,
    decidedAt: a.decided_at,
  }));
  return {
    accountId,
    connectors: (conns ?? []).map((c) => ({ platform: c.platform, name: NAME_BY_PLATFORM[c.platform] ?? c.platform, status: c.status, lastSyncAt: c.last_sync_at, lastSyncResult: c.last_sync_result })),
    routineStates: (rs ?? []).map((r) => ({ routineId: r.routine_id, name: NAME_BY_ROUTINE[r.routine_id] ?? r.routine_id, enabled: !!r.enabled })),
    plan: plan ? { title: plan.title, phases: Array.isArray(plan.phases) ? plan.phases : [], agreedAt: plan.agreed_at } : null,
    resources: rp ? { budgetMonthly: Number(rp.budget_monthly), hoursWeekly: Number(rp.hours_weekly), skills: rp.skills ?? [], postures: rp.postures ?? [] } : null,
    approvals: approvals.filter((a) => a.status === "pending"),
    decided: approvals.filter((a) => a.status !== "pending").slice(0, 10),
    runs: (runs ?? []).map((r) => ({ id: r.id, routineId: r.routine_id, mode: r.mode, status: r.status, startedAt: r.started_at })),
    receipts: (rcs ?? []).map((r) => ({ id: r.id, kind: r.kind, text: r.description, createdAt: r.created_at })),
    fetchedAt: new Date().toISOString(),
  };
}
