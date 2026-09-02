/* Setup progress — the five spine steps of docs/PRODUCT-EXPERIENCE.md with REAL states:

     1 Agree the plan      plans.agreed_at set
     2 Connect your data   ≥ 1 connectors.status = 'connected' (or the founder said "later" — honest)
     3 First routine on    ≥ 1 routine_states.enabled AND a first routine_runs row finished
     4 First review        first taste_events row
     5 Daily rhythm        a daily_briefs row exists

   computeSetupProgress(rows, now)  pure — what the tests drive
   setupProgress(db, accountId)     loads the rows through the DbClient slice (RLS or service
                                    role — the caller's choice) and computes

   Every line is Unc's voice, first person, numbers over adjectives. Exactly one step carries
   the founder's next action (the first undone one that has an action), so the Home card shows
   amber on at most one row. */

import { ensureAccountName } from "../db/accountState";
import { unwrap, type DbClient } from "../db/types";
import type { ChannelKey, Posture } from "../platform/plan";
import type { Platform } from "../runtime/types";
import { modelFromProfile, type BusinessModel, type PlatformEvidence } from "../unc/businessType";
import { emailQuestionNeeded, phaseOneChannel, platformName, recommendedRoutine, requiredPlatform, routineBenefit, routineName, suggestPlatforms } from "./channels";

export type SetupStepKey = "plan" | "connect" | "routine" | "review" | "brief";

export const SETUP_STEP_TITLES: Record<SetupStepKey, string> = {
  plan: "Agree the plan",
  connect: "Connect your data",
  routine: "First routine on",
  review: "First review",
  brief: "Daily rhythm",
};

/** Where the next action points: a Home anchor (#…), a view, or a guided step. */
export type SetupAnchor = "#getting-set-up" | "#needs-you" | "#what-i-drafted" | "#today-brief" | "#setting-up-next" | "view:connectors" | "view:systems" | "view:strategy" | "step:connect" | "step:routine";

export interface SetupNextAction {
  step: SetupStepKey;
  label: string;
  anchor: SetupAnchor;
}

export interface SetupStepView {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** One line, Unc's voice. */
  status: string;
  /** Step 2 only: the founder chose "later" — shown as a quiet dot, not a check, never amber. */
  later?: boolean;
}

export interface SetupPlatformView {
  platform: Platform;
  name: string;
  status: "connected" | "disconnected" | "needs_reconnect" | "connecting" | "error";
  /** picked = the founder said they use it; spotted = evidenced on their site. */
  source: "picked" | "spotted";
  evidence?: string;
}

export interface SetupRoutineView {
  routineId: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

export interface SetupProgress {
  channel: ChannelKey;
  agreedAt: string | null;
  steps: SetupStepView[];
  done: number;
  allDone: boolean;
  nextAction: SetupNextAction | null;
  connectLater: boolean;
  dismissed: boolean;
  /** The founder's own platforms (picked in onboarding, or spotted on their site) with their real connector status — never a table's. */
  platforms: SetupPlatformView[];
  /** What kind of business this is (scan / founder), null fields when unknown. */
  business: BusinessModel;
  /** Phase 1 is Email and nothing says how email is sent: the step asks one question. */
  emailQuestion: boolean;
  /** The one recommended wave-1 routine (null only if nothing fits the business and channel). */
  recommended: { routineId: string; name: string; benefit: string; enabled: boolean; requiredPlatform: Platform | null; requiredConnected: boolean } | null;
  /** Enabled routines with their newest run. */
  routines: SetupRoutineView[];
  /** Runs in flight right now. */
  running: { runId: string; routineId: string; name: string; startedAt: string }[];
  counts: { connected: number; enabled: number; runsDone: number; runsThisWeek: number };
}

// ---------- inputs ----------

export interface SetupRows {
  plans: { agreed_at: string | null; created_at?: string | null }[];
  connectors: { platform: string; status: string }[];
  routineStates: { routine_id: string; enabled: boolean }[];
  /** Newest first. */
  runs: { id: string; routine_id: string; status: string; started_at: string; finished_at?: string | null; mode?: string }[];
  firstTasteEventAt: string | null;
  latestBrief: { day: string; created_at?: string | null } | null;
  clientState: { setupConnectLater?: unknown; setupCardDismissed?: unknown; setupFlow?: unknown } | null;
  resourceProfile: { postures?: string[] | null; skills?: string[] | null; budget_monthly?: number | string | null; known_platforms?: string[] | null } | null;
  /** business_profiles.profile (the scan + the founder's business-type pick); absent on rows read before it existed. */
  businessProfile?: { profile?: unknown } | null;
}

const POSTURE_FROM_DB: Record<string, Posture> = { brand_led: "brand", sales_led: "sales", paid_led: "paid" };
const FINISHED = new Set(["done", "waiting_approval", "skipped"]);
const DAY_MS = 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Sep" (UTC; deterministic across ICU builds). A bare YYYY-MM-DD day is read as that day. */
const dayLabel = (iso: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// ---------- the pure computation ----------

export function computeSetupProgress(rows: SetupRows, now: Date = new Date()): SetupProgress {
  const rp = rows.resourceProfile;
  const posture = POSTURE_FROM_DB[(rp?.postures ?? [])[0] ?? ""] ?? "brand";
  const channel = phaseOneChannel({ posture, strengths: rp?.skills ?? [], budgetMo: Number(rp?.budget_monthly ?? 0) || 0 });

  const agreedAt = rows.plans.map((p) => p.agreed_at).filter((a): a is string => typeof a === "string" && !!a).sort()[0] ?? null;

  const connStatus = new Map(rows.connectors.map((c) => [c.platform, c.status]));
  const knownPlatforms = rp?.known_platforms ?? [];
  const profile = rows.businessProfile?.profile ?? null;
  const business = modelFromProfile(profile);
  const spotted = profile && typeof profile === "object" && Array.isArray((profile as { platformsSpotted?: unknown }).platformsSpotted) ? ((profile as { platformsSpotted: PlatformEvidence[] }).platformsSpotted ?? []) : [];
  const platforms: SetupPlatformView[] = suggestPlatforms({ channel, knownPlatforms, spotted }).map((s) => ({
    platform: s.platform,
    name: s.name,
    status: (connStatus.get(s.platform) as SetupPlatformView["status"]) ?? "disconnected",
    source: s.source,
    ...(s.evidence ? { evidence: s.evidence } : {}),
  }));
  const connectedAll = rows.connectors.filter((c) => c.status === "connected");
  const emailQuestion = emailQuestionNeeded({ channel, knownPlatforms, spotted, connected: connectedAll.map((c) => c.platform) });
  const connectLater = rows.clientState?.setupConnectLater === true;
  const dismissed = rows.clientState?.setupCardDismissed === true;

  const enabledIds = rows.routineStates.filter((r) => r.enabled).map((r) => r.routine_id);
  const finishedRuns = rows.runs.filter((r) => FINISHED.has(r.status));
  const firstRun = [...finishedRuns].sort((a, b) => (a.started_at < b.started_at ? -1 : 1))[0] ?? null;
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const runsThisWeek = finishedRuns.filter((r) => r.started_at >= weekAgo).length;

  const rec = recommendedRoutine(channel, enabledIds, { model: business, knownPlatforms });
  const recRequired = rec ? requiredPlatform(rec) : null;
  const recommended = rec
    ? { routineId: rec.id, name: routineName(rec.id), benefit: routineBenefit(rec.id), enabled: enabledIds.includes(rec.id), requiredPlatform: recRequired, requiredConnected: !recRequired || connStatus.get(recRequired) === "connected" }
    : null;

  const routines: SetupRoutineView[] = enabledIds.map((id) => {
    const last = rows.runs.find((r) => r.routine_id === id) ?? null;
    return { routineId: id, name: routineName(id), enabled: true, lastRunAt: last?.started_at ?? null, lastRunStatus: last?.status ?? null };
  });
  const running = rows.runs.filter((r) => r.status === "running").map((r) => ({ runId: r.id, routineId: r.routine_id, name: routineName(r.routine_id), startedAt: r.started_at }));

  // ----- the five steps -----
  /* The connect line names the founder's own first platform — never a default. With nothing
     picked or spotted there is nothing to name: Unc asks for the tools instead. */
  const anchorName = platforms[0]?.name ?? null;
  const connectAsk = anchorName ? `Connect ${anchorName} and I'll read your last 90 days tonight.` : "Tell me which tools you use and I'll connect only what the plan reads.";
  const planDone = !!agreedAt;
  const connectDone = connectedAll.length >= 1;
  const routineDone = enabledIds.length >= 1 && !!firstRun;
  const reviewDone = !!rows.firstTasteEventAt;
  const briefDone = !!rows.latestBrief;

  const steps: SetupStepView[] = [
    {
      key: "plan",
      title: SETUP_STEP_TITLES.plan,
      done: planDone,
      status: planDone ? `Agreed ${dayLabel(agreedAt!)} — phase 1 is ${channel}.` : "Agree the plan and I build everything else around it.",
    },
    {
      key: "connect",
      title: SETUP_STEP_TITLES.connect,
      done: connectDone,
      later: !connectDone && connectLater,
      status: connectDone
        ? `${connectedAll.length} connected — ${list(connectedAll.map((c) => platformName(c.platform)))}. I read them on the nightly run.`
        : connectLater
          ? `You said later. ${connectAsk}`
          : connectAsk,
    },
    {
      key: "routine",
      title: SETUP_STEP_TITLES.routine,
      done: routineDone,
      status: routineDone
        ? `${enabledIds.length} on — first run finished ${dayLabel(firstRun!.finished_at || firstRun!.started_at)}.`
        : enabledIds.length >= 1
          ? `${routineName(enabledIds[0])} is on — the first dry run hasn't landed yet.`
          : rec
            ? `Your plan starts with ${channel} — ${routineName(rec.id)} first.`
            : `Your plan starts with ${channel}.`,
    },
    {
      key: "review",
      title: SETUP_STEP_TITLES.review,
      done: reviewDone,
      status: reviewDone ? `First review logged ${dayLabel(rows.firstTasteEventAt!)} — I'm learning your taste from it.` : firstRun ? "Open what I drafted and give me a yes, a hold or a why." : "Your first draft brings the first review — nothing to judge yet.",
    },
    {
      key: "brief",
      title: SETUP_STEP_TITLES.brief,
      done: briefDone,
      status: briefDone ? `Brief written for ${dayLabel(rows.latestBrief!.day)} — the next one comes each morning.` : routineDone ? "Write today's brief now, or wait for tomorrow morning's." : "Your first brief comes the morning after your first routine runs.",
    },
  ];

  const actions: Partial<Record<SetupStepKey, SetupNextAction>> = {
    plan: { step: "plan", label: "Agree the plan", anchor: "view:strategy" },
    connect: { step: "connect", label: anchorName ? `Connect ${anchorName}` : "Choose your tools", anchor: rows.clientState?.setupFlow === "connect" ? "step:connect" : "view:connectors" },
    routine:
      enabledIds.length >= 1
        ? { step: "routine", label: "Run it now", anchor: "view:systems" }
        : rec
          ? { step: "routine", label: `Turn on ${routineName(rec.id)}`, anchor: rows.clientState?.setupFlow === "routine" ? "step:routine" : "#setting-up-next" }
          : undefined,
    review: firstRun ? { step: "review", label: "Review the first draft", anchor: "#what-i-drafted" } : undefined,
    brief: routineDone ? { step: "brief", label: "Write today's brief", anchor: "#today-brief" } : undefined,
  };
  // "later" on connect is an honest answer, not a nag: the next action moves on to the routine.
  const first = steps.find((s) => !s.done && !(s.key === "connect" && connectLater) && actions[s.key]);
  const nextAction = first ? actions[first.key]! : null;

  const done = steps.filter((s) => s.done).length;
  return {
    channel,
    agreedAt,
    steps,
    done,
    allDone: done === steps.length,
    nextAction,
    connectLater,
    dismissed,
    platforms,
    business,
    emailQuestion,
    recommended,
    routines,
    running,
    counts: { connected: connectedAll.length, enabled: enabledIds.length, runsDone: finishedRuns.length, runsThisWeek },
  };
}

// ---------- loading ----------

export async function loadSetupRows(db: DbClient, accountId: string): Promise<SetupRows> {
  const by = (table: string, columns: string) => db.from(table).select(columns).eq("account_id", accountId);
  const [plans, connectors, routineStates, runs, taste, briefs, meta, rp, bp] = await Promise.all([
    unwrap<SetupRows["plans"]>("plans.select", by("plans", "agreed_at, created_at")),
    unwrap<SetupRows["connectors"]>("connectors.select", by("connectors", "platform, status")),
    unwrap<SetupRows["routineStates"]>("routine_states.select", by("routine_states", "routine_id, enabled")),
    unwrap<SetupRows["runs"]>("routine_runs.select", by("routine_runs", "id, routine_id, status, mode, started_at, finished_at").order("started_at", { ascending: false }).limit(60)),
    unwrap<{ created_at: string }[]>("taste_events.select", by("taste_events", "created_at").order("created_at", { ascending: true }).limit(1)),
    unwrap<{ day: string; created_at: string }[]>("daily_briefs.select", by("daily_briefs", "day, created_at").order("day", { ascending: false }).limit(1)),
    unwrap<{ client_state: SetupRows["clientState"] } | null>("account_state_meta.select", by("account_state_meta", "client_state").maybeSingle()),
    unwrap<SetupRows["resourceProfile"]>("resource_profiles.select", by("resource_profiles", "postures, skills, budget_monthly, known_platforms").maybeSingle()),
    unwrap<{ profile: unknown } | null>("business_profiles.select", by("business_profiles", "profile").maybeSingle()),
  ]);
  return {
    plans: plans ?? [],
    connectors: connectors ?? [],
    routineStates: routineStates ?? [],
    runs: runs ?? [],
    firstTasteEventAt: taste?.[0]?.created_at ?? null,
    latestBrief: briefs?.[0] ?? null,
    clientState: meta?.client_state ?? null,
    resourceProfile: rp ?? null,
    businessProfile: bp ?? null,
  };
}

export async function setupProgress(db: DbClient, accountId: string, now: Date = new Date()): Promise<SetupProgress> {
  return computeSetupProgress(await loadSetupRows(db, accountId), now);
}

// ---------- agree the plan ----------

/** Set plans.agreed_at on the account's newest plan (idempotent: an agreed plan keeps its
    original timestamp). With no plan row yet — the autosave that writes it may still be in
    flight — a minimal row is inserted; the autosave updates that same (newest) row after.
    Agreeing is also when the account gets its name (accounts.name was '' for real accounts):
    the scan's business name, else the website host, else the founder's goal text. */
export async function agreePlan(db: DbClient, accountId: string, now: Date = new Date()): Promise<{ agreedAt: string; created: boolean; accountName: string | null }> {
  const rows = await unwrap<{ id: string; agreed_at: string | null; created_at: string }[]>(
    "plans.select",
    db.from("plans").select("id, agreed_at, created_at").eq("account_id", accountId).order("created_at", { ascending: false }),
  );
  const accountName = await ensureAccountName(db, accountId).catch(() => null);
  const already = rows.map((r) => r.agreed_at).filter((a): a is string => !!a).sort()[0];
  if (already) return { agreedAt: already, created: false, accountName };
  const stamp = now.toISOString();
  if (rows.length) {
    await unwrap("plans.update", db.from("plans").update({ agreed_at: stamp }).eq("id", rows[0].id));
    return { agreedAt: stamp, created: false, accountName };
  }
  await unwrap("plans.insert", db.from("plans").insert({ account_id: accountId, title: "", phases: [], narrative: null, agreed_at: stamp }));
  return { agreedAt: stamp, created: true, accountName };
}
