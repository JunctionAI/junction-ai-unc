/* PlatformState ↔ database rows — pure functions, no I/O. This is where the persistence
   correctness lives; src/lib/db/__tests__/mapping.test.ts round-trips every field.

   Column homes (supabase/migrations/0001 + 0003):
     currency                         accounts.currency
     goal (title/deadline/baseline)   goals            one row per selected category; governing = obCats[0]
     budget/hours/reinvest/margin,
     website/socials, strengths,
     known platforms, postures,
     breadth                          resource_profiles
     team                             team_members     ordered by position; areas → approves ("A, B")
     plan (current play + phases)     plans            derived view for readers; edits round-trip via client_state
     scan profile                     business_profiles
     routine on/off                   routine_states.enabled   (name ↔ catalog id)
     connector status                 connectors.status
     chat threads                     chat_messages    thread ∈ corner | onboarding | human, ordered by position
     everything UI-shaped that has
     no column (goal texts per
     category, plan edits, the Unc
     narrative, wf version …)         account_state_meta.client_state (schema-versioned blob)

   Not persisted: the three demo approval cards (derive.ts AP_DATA / apStatus) — they are demo
   furniture, never a real account's decisions; accounts mode reads its approvals from the
   runtime (GET /api/approvals). Before 2026-09-02 they were upserted as approvals rows keyed
   client_key "demo-ap-<i>"; existing rows are simply ignored now.
   Not persisted (transient UI): view, selCat, sel, draft, apWhy, propStatus, nodeSel,
   nodeVals, chatOpen, setupOpen/Step/Done, readThread/readDraft, chatMode, addOpen,
   obMoneyOpen, obTeamOpen, obDraft, buddyText, typing placeholders. */

import { ALL_SYSTEMS } from "../platform/catalog";
import { postureDefs } from "../platform/postures";
import type { Posture } from "../platform/plan";
import {
  initialState,
  type Breadth,
  type ConnStatus,
  type Msg,
  type NarrativeState,
  type ObAnswered,
  type PlatformState,
  type Profile,
  type Reinvest,
  type SetupFlow,
  type TeamMember,
  type WfState,
} from "../platform/state";
import type { BusinessProfile } from "../unc/scan";

export const CLIENT_STATE_SCHEMA_VERSION = 1;

// ---------- row shapes (subset of columns the client reads/writes) ----------

export interface AccountRow {
  context_generation?: number;
  automation_paused?: boolean;
  id: string;
  currency: string;
  /** accounts.name — read for the sidebar header; written once at plan agreement (src/lib/db/accountState.ts ensureAccountName). */
  name?: string;
}
export interface GoalRow {
  account_id: string;
  category: string;
  tier: "governing" | "checkpoint";
  title: string;
  baseline: number | null;
  deadline: string | null;
}
export interface ResourceProfileRow {
  account_id: string;
  budget_monthly: number | null;
  hours_weekly: number | null;
  reinvestment: "steady" | "balanced" | "all_in";
  gross_margin_pct: number | null;
  website: string | null;
  socials: string[];
  skills: string[];
  known_platforms: string[];
  postures: string[];
  breadth: Breadth;
}
export interface TeamMemberRow {
  account_id: string;
  position: number;
  name: string;
  role: string;
  approves: string | null;
}
export interface PlanPhaseJson {
  n: string;
  name: string;
  status: string;
  routines: string[];
  from_you: string;
}
export interface PlanRow {
  account_id: string;
  title: string;
  phases: PlanPhaseJson[];
  narrative: string | null;
}
export interface BusinessProfileRow {
  account_id: string;
  scan_status: "pending" | "running" | "done" | "failed";
  profile: Record<string, unknown>;
  scanned_at: string | null;
}
export interface RoutineStateRow {
  account_id: string;
  routine_id: string;
  enabled: boolean;
}
export interface ConnectorRow {
  account_id: string;
  platform: string;
  status: "connected" | "disconnected" | "needs_reconnect";
}
export interface ChatMessageRow {
  account_id: string;
  thread: "corner" | "onboarding" | "human";
  position: number;
  lane: "ai" | "human";
  sender: "user" | "unc" | "staff";
  body: string;
  meta: { link?: string; linkLabel?: string };
}
export interface ClientState {
  onboarded: boolean;
  obStep: number;
  obCats: string[];
  posture: Posture;
  goalTexts: Record<string, string>;
  baselineText: string;
  targetNum: number;
  obPace: string;
  profile: Profile;
  routineEdits: Record<string, string[]>;
  narrative: NarrativeState;
  scanKey: string | null;
  wfState: WfState;
  wfVer: number;
  /** Guided first run (2026-09-02, additive; absent on rows saved before it → defaults). */
  setupFlow?: SetupFlow;
  setupConnectLater?: boolean;
  setupCardDismissed?: boolean;
  /** Which onboarding numbers were typed (2026-09-02, additive). Absent on older rows → treated as answered: those founders agreed a plan already. */
  obAnswered?: ObAnswered;
}
export interface StateMetaRow {
  account_id: string;
  schema_version: number;
  client_state: ClientState;
}

export interface AccountRows {
  account: AccountRow;
  goals: GoalRow[];
  resourceProfile: ResourceProfileRow;
  teamMembers: TeamMemberRow[];
  plan: PlanRow;
  businessProfile: BusinessProfileRow;
  routineStates: RoutineStateRow[];
  connectors: ConnectorRow[];
  chatMessages: ChatMessageRow[];
  stateMeta: StateMetaRow;
}

/** What loadAccountState hands back: any table may be empty for a fresh account. */
export type LoadedRows = {
  account: AccountRow | null;
  goals: GoalRow[];
  resourceProfile: ResourceProfileRow | null;
  teamMembers: TeamMemberRow[];
  businessProfile: BusinessProfileRow | null;
  routineStates: RoutineStateRow[];
  connectors: ConnectorRow[];
  chatMessages: ChatMessageRow[];
  stateMeta: StateMetaRow | null;
};

// ---------- enum bridges ----------

const REINVEST_TO_DB: Record<Reinvest, ResourceProfileRow["reinvestment"]> = { steady: "steady", balanced: "balanced", aggressive: "all_in" };
const REINVEST_FROM_DB: Record<ResourceProfileRow["reinvestment"], Reinvest> = { steady: "steady", balanced: "balanced", all_in: "aggressive" };
const POSTURE_TO_DB: Record<Posture, string> = { brand: "brand_led", sales: "sales_led", paid: "paid_led" };
const POSTURE_FROM_DB: Record<string, Posture> = { brand_led: "brand", sales_led: "sales", paid_led: "paid" };
const SCAN_TO_DB: Record<PlatformState["scan"]["status"], BusinessProfileRow["scan_status"]> = { idle: "pending", running: "running", done: "done", failed: "failed" };
const SCAN_FROM_DB: Record<BusinessProfileRow["scan_status"], PlatformState["scan"]["status"]> = { pending: "idle", running: "running", done: "done", failed: "failed" };
const CONN_TO_DB: Record<ConnStatus, ConnectorRow["status"]> = { ok: "connected", off: "disconnected", expired: "needs_reconnect" };
const CONN_FROM_DB: Record<string, ConnStatus> = { connected: "ok", disconnected: "off", needs_reconnect: "expired", connecting: "off", error: "expired" };
const SENDER_TO_DB: Record<Msg["from"], ChatMessageRow["sender"]> = { j: "unc", u: "user", h: "staff" };
const SENDER_FROM_DB: Record<ChatMessageRow["sender"], Msg["from"]> = { unc: "j", user: "u", staff: "h" };

/** Connector card name ↔ connectors.platform slug (mirrors the runtime Platform union). */
export const CONNECTOR_PLATFORMS: Record<string, string> = {
  Shopify: "shopify",
  "Google Analytics 4": "ga4",
  "Meta Ads": "meta_ads",
  "Google Ads": "google_ads",
  Klaviyo: "klaviyo",
  Instagram: "instagram",
  TikTok: "tiktok",
  LinkedIn: "linkedin",
  YouTube: "youtube",
  "Google Search Console": "search_console",
  HubSpot: "hubspot",
  Gmail: "gmail",
  Gorgias: "gorgias",
  Xero: "xero",
  QuickBooks: "quickbooks",
  Slack: "slack",
};
const CONNECTOR_NAMES: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

const ROUTINE_ID_BY_NAME: Record<string, string> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.name, s.id]));
const ROUTINE_NAME_BY_ID: Record<string, string> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, s.name]));

const THREADS: { thread: ChatMessageRow["thread"]; key: "messages" | "obThread" | "humanThread"; lane: ChatMessageRow["lane"] }[] = [
  { thread: "corner", key: "messages", lane: "ai" },
  { thread: "onboarding", key: "obThread", lane: "ai" },
  { thread: "human", key: "humanThread", lane: "human" },
];

const AREAS_SEP = ", ";
const SOCIALS_SEP = "\n";

/** Prose rendering of the structured narrative for plans.narrative (readers/agents); the
    structured value round-trips through client_state. */
export function narrativeProse(n: NarrativeState["value"]): string | null {
  if (!n) return null;
  return [n.title, n.mathLine, ...n.phaseNotes, n.footnote].filter(Boolean).join("\n\n");
}

/** Current play's phases with the founder's routine edits applied (derive.ts rKey semantics). */
export function planPhases(posture: Posture, routineEdits: Record<string, string[]>): PlanPhaseJson[] {
  const def = postureDefs[posture] ?? postureDefs.brand;
  return def.phases.map((ph, i) => ({
    n: ph.n,
    name: ph.name,
    status: ph.st,
    routines: routineEdits[`${posture}.${i}`] ?? ph.routines,
    from_you: ph.you,
  }));
}

// ---------- state → rows ----------

/** `opts.userId` is accepted for call-site compatibility; nothing persisted carries it since the demo approvals went. */
export function stateToRows(accountId: string, S: PlatformState, opts: { userId?: string; now?: string } = {}): AccountRows {
  const now = opts.now ?? new Date().toISOString();
  const goals: GoalRow[] = S.obCats.map((category, i) => ({
    account_id: accountId,
    category,
    tier: i === 0 ? "governing" : "checkpoint",
    title: i === 0 ? S.goalTitle : S.goalTexts[category] ?? "",
    baseline: i === 0 ? S.baselineNum : null,
    deadline: i === 0 ? S.deadline || null : null,
  }));

  const resourceProfile: ResourceProfileRow = {
    account_id: accountId,
    budget_monthly: S.obAnswered.budget ? S.budgetMo : null,
    hours_weekly: S.obAnswered.hours ? S.hoursWk : null,
    reinvestment: REINVEST_TO_DB[S.reinvest] ?? "balanced",
    gross_margin_pct: S.marginPct,
    website: S.website || null,
    socials: S.socials ? S.socials.split(SOCIALS_SEP) : [],
    skills: [...S.obStrengths],
    known_platforms: [...S.obPlatforms],
    postures: S.obPostureSet.map((p) => POSTURE_TO_DB[p]).filter(Boolean),
    breadth: S.obBreadth,
  };

  const teamMembers: TeamMemberRow[] = S.team.map((m, position) => ({
    account_id: accountId,
    position,
    name: m.name,
    role: m.role,
    approves: m.areas.length ? m.areas.join(AREAS_SEP) : null,
  }));

  const plan: PlanRow = {
    account_id: accountId,
    title: S.obAnswered.budget && S.obAnswered.hours ? (postureDefs[S.posture] ?? postureDefs.brand).label : "",
    phases: S.obAnswered.budget && S.obAnswered.hours ? planPhases(S.posture, S.routineEdits) : [],
    narrative: S.obAnswered.budget && S.obAnswered.hours ? narrativeProse(S.narrative.value) : null,
  };

  const businessProfile: BusinessProfileRow = {
    account_id: accountId,
    scan_status: SCAN_TO_DB[S.scan.status] ?? "pending",
    profile: (S.scan.profile as unknown as Record<string, unknown>) ?? {},
    scanned_at: S.scan.status === "done" ? now : null,
  };

  const routineStates: RoutineStateRow[] = Object.entries(S.routineOn)
    .filter(([name]) => ROUTINE_ID_BY_NAME[name])
    .map(([name, enabled]) => ({ account_id: accountId, routine_id: ROUTINE_ID_BY_NAME[name], enabled }));

  const connectors: ConnectorRow[] = Object.entries(S.connState)
    .filter(([name, st]) => CONNECTOR_PLATFORMS[name] && CONN_TO_DB[st])
    .map(([name, st]) => ({ account_id: accountId, platform: CONNECTOR_PLATFORMS[name], status: CONN_TO_DB[st] }));

  const chatMessages: ChatMessageRow[] = THREADS.flatMap(({ thread, key, lane }) =>
    S[key]
      .filter((m) => !m.typing)
      .map((m, position) => ({
        account_id: accountId,
        thread,
        position,
        lane,
        sender: SENDER_TO_DB[m.from],
        body: m.text,
        meta: { ...(m.link ? { link: m.link } : {}), ...(m.linkLabel ? { linkLabel: m.linkLabel } : {}) },
      })),
  );

  const stateMeta: StateMetaRow = {
    account_id: accountId,
    schema_version: CLIENT_STATE_SCHEMA_VERSION,
    client_state: {
      onboarded: S.onboarded,
      obStep: S.obStep,
      obCats: [...S.obCats],
      posture: S.posture,
      goalTexts: { ...S.goalTexts },
      baselineText: S.baselineText,
      targetNum: S.targetNum,
      obPace: S.obPace,
      profile: { ...S.profile },
      routineEdits: Object.fromEntries(Object.entries(S.routineEdits).map(([k, v]) => [k, [...v]])),
      narrative: { ...S.narrative },
      scanKey: S.scan.key,
      wfState: S.wfState,
      wfVer: S.wfVer,
      setupFlow: S.setupFlow,
      setupConnectLater: S.setupConnectLater,
      setupCardDismissed: S.setupCardDismissed,
      obAnswered: { ...S.obAnswered },
    },
  };

  return {
    account: { id: accountId, currency: S.currency },
    goals,
    resourceProfile,
    teamMembers,
    plan,
    businessProfile,
    routineStates,
    connectors,
    chatMessages,
    stateMeta,
  };
}

// ---------- rows → state ----------

/** Rebuild the persisted slice of PlatformState over `base` (transient UI fields keep base's
    values). Tolerates a partially populated account: whatever is missing keeps base's value. */
export function rowsToState(rows: LoadedRows, base: PlatformState = initialState): PlatformState {
  const S: PlatformState = { ...base };
  S.contextGeneration = rows.account?.context_generation ?? 0;
  S.automationPaused = rows.account?.automation_paused === true;
  const cs = rows.stateMeta?.client_state;

  if (rows.account?.currency) S.currency = rows.account.currency;

  if (cs) {
    S.onboarded = cs.onboarded;
    S.obStep = cs.obStep;
    if (Array.isArray(cs.obCats)) S.obCats = [...cs.obCats];
    S.posture = cs.posture;
    S.goalTexts = { ...base.goalTexts, ...cs.goalTexts };
    S.baselineText = cs.baselineText;
    S.targetNum = cs.targetNum;
    S.obPace = cs.obPace;
    S.profile = { ...cs.profile };
    S.routineEdits = { ...cs.routineEdits };
    S.narrative = { ...cs.narrative };
    S.wfState = cs.wfState;
    S.wfVer = cs.wfVer;
    // rows saved before the guided first run existed carry none of these: "home" (never trap an existing account)
    S.setupFlow = cs.setupFlow === "connect" || cs.setupFlow === "routine" || cs.setupFlow === "channel" ? cs.setupFlow : "home";
    S.setupConnectLater = cs.setupConnectLater === true;
    S.setupCardDismissed = cs.setupCardDismissed === true;
    // rows saved before the flags existed: the founder typed (or agreed) those numbers — never re-ask
    S.obAnswered = cs.obAnswered ? { target: !!cs.obAnswered.target, budget: !!cs.obAnswered.budget, hours: !!cs.obAnswered.hours } : { target: true, budget: true, hours: true };
  }

  if (rows.goals.length) {
    const governing = rows.goals.find((g) => g.tier === "governing") ?? rows.goals[0];
    const checkpoints = rows.goals.filter((g) => g !== governing);
    // client_state keeps the founder's category order; goals rows are the relational view
    if (!cs?.obCats?.length) S.obCats = [governing.category, ...checkpoints.map((g) => g.category)];
    S.goalTitle = governing.title;
    S.deadline = governing.deadline ?? "";
    // NULL is "not set" — surfaced as such, never replaced by the base state's (demo) number
    S.baselineNum = governing.baseline === null || governing.baseline === undefined ? null : Number(governing.baseline);
    S.goalTexts = { ...S.goalTexts, ...Object.fromEntries(rows.goals.map((g) => [g.category, g.title])) };
  }

  const rp = rows.resourceProfile;
  if (rp) {
    S.budgetMo = Number(rp.budget_monthly);
    S.hoursWk = Number(rp.hours_weekly);
    // UI inputs keep numeric placeholders, but null storage always wins over an
    // old answered flag and renders/saves as unknown until explicitly supplied.
    if (rp.budget_monthly == null) S.obAnswered = { ...S.obAnswered, budget: false };
    if (rp.hours_weekly == null) S.obAnswered = { ...S.obAnswered, hours: false };
    S.reinvest = REINVEST_FROM_DB[rp.reinvestment] ?? base.reinvest;
    S.marginPct = rp.gross_margin_pct === null || rp.gross_margin_pct === undefined ? null : Number(rp.gross_margin_pct);
    S.website = rp.website ?? "";
    S.socials = (rp.socials ?? []).join(SOCIALS_SEP);
    S.obStrengths = [...(rp.skills ?? [])];
    S.obPlatforms = [...(rp.known_platforms ?? [])];
    const postures = (rp.postures ?? []).map((p) => POSTURE_FROM_DB[p]).filter((p): p is Posture => !!p);
    if (postures.length) {
      S.obPostureSet = postures;
      if (!cs) S.posture = postures[0];
    }
    S.obBreadth = rp.breadth;
  }

  if (rows.teamMembers.length || cs) {
    S.team = [...rows.teamMembers]
      .sort((a, b) => a.position - b.position)
      .map<TeamMember>((m) => ({ name: m.name, role: m.role, areas: m.approves ? m.approves.split(AREAS_SEP) : [] }));
  }

  const bp = rows.businessProfile;
  if (bp) {
    const hasProfile = bp.profile && Object.keys(bp.profile).length > 0;
    S.scan = {
      status: SCAN_FROM_DB[bp.scan_status] ?? "idle",
      key: cs?.scanKey ?? null,
      profile: hasProfile ? (bp.profile as unknown as BusinessProfile) : null,
    };
  }

  if (rows.routineStates.length) {
    S.routineOn = { ...base.routineOn };
    for (const r of rows.routineStates) {
      const name = ROUTINE_NAME_BY_ID[r.routine_id];
      if (name) S.routineOn[name] = !!r.enabled;
    }
  }

  if (rows.connectors.length) {
    S.connState = { ...base.connState };
    for (const c of rows.connectors) {
      const name = CONNECTOR_NAMES[c.platform];
      const st = CONN_FROM_DB[c.status];
      if (name && st) S.connState[name] = st;
    }
  }

  if (rows.chatMessages.length || cs) {
    for (const { thread, key } of THREADS) {
      const msgs = rows.chatMessages
        .filter((m) => m.thread === thread)
        .sort((a, b) => a.position - b.position)
        .map<Msg>((m) => ({
          from: SENDER_FROM_DB[m.sender] ?? "j",
          text: m.body,
          ...(m.meta?.link ? { link: m.meta.link } : {}),
          ...(m.meta?.linkLabel ? { linkLabel: m.meta.linkLabel } : {}),
        }));
      if (msgs.length || cs) S[key] = msgs;
    }
  }

  return S;
}

/** The persisted projection of a state — two states with equal projections need no save. */
export function persistedProjection(S: PlatformState): string {
  const { routineStates: _routineStates, connectors: _connectors, ...autosaved } = stateToRows("_", S, { now: "_" });
  return JSON.stringify(autosaved);
}
