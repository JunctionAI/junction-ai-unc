/* The prototype's complete state shape + demo initial state — ported verbatim from
   design-reference/platform-v2-logic.js `this.state`. Client-side only for Phase 1;
   "Skip — explore with demo data" lands straight on this dataset. */

import type { RoutineDef } from "./catalog";
import type { Posture } from "./plan";
import type { BusinessProfile } from "@/lib/unc/scan";
import type { PlanNarrative } from "@/lib/unc/narrative";

export type View = "today" | "systems" | "connectors" | "strategy" | "channels";
export type ApStatus = "pending" | "approved" | "held";
export type PropStatus = "ready" | "blocked" | "building";
export type WfState = "clean" | "draft" | "validated";
export type ConnStatus = "ok" | "off" | "expired";
export type ChatMode = "ai" | "human";
export type Breadth = "focused" | "broad";
export type Reinvest = "steady" | "balanced" | "aggressive";

export interface Msg {
  from: "j" | "u" | "h";
  text: string;
  link?: string;
  linkLabel?: string;
  /** Transient placeholder while a live Unc reply is in flight (rendered as pulsing dots). */
  typing?: boolean;
}

export interface TeamMember {
  name: string;
  role: string;
  areas: string[];
}

export interface Profile {
  budget: string;
  time: string;
  strength: string;
  belief: string;
  team: string;
}

export type AsyncStatus = "idle" | "running" | "done" | "failed";

/** Onboarding step-4 site/socials scan (fired in the background on leaving step 4). */
export interface ScanState {
  status: AsyncStatus;
  /** JSON key of the {website, socials} input this result belongs to. */
  key: string | null;
  profile: BusinessProfile | null;
}

/** Unc's prose for the step-6 plan card; the deterministic copy is the instant fallback. */
export interface NarrativeState {
  status: AsyncStatus;
  /** Key of the full request (plan + resources + goal + profile) the value answers. */
  key: string | null;
  /** Key of the request minus the profile — lets the last narrative stay up while the scan sharpens it. */
  baseKey: string | null;
  value: PlanNarrative | null;
}

/** Where the founder is in the guided first run after "Agree the plan →" (accounts mode):
    connect → the "Connect your data" step, routine → the "First routine on" step, home → Home.
    Persisted in account_state_meta.client_state so a refresh lands on the same step. */
export type SetupFlow = "connect" | "routine" | "channel" | "home";

/** Which onboarding numbers the founder has actually typed. Demo mode is fully "answered" (the
    prototype's dataset); a real account starts with every flag false so the inputs render empty
    (placeholders only) and the plan generator asks before it drafts anything. A typed 0 is a
    real answer — that is why these are flags and not a magic number. Persisted in client_state. */
export interface ObAnswered {
  target: boolean;
  budget: boolean;
  hours: boolean;
}

export interface PlatformState {
  /** Server-owned business identity version. Never written through client_state. */
  contextGeneration?: number;
  /** Server-owned maintenance hold, never persisted from browser input. */
  automationPaused?: boolean;
  view: View;
  selCat: string;
  sel: RoutineDef | null;
  draft: string;
  goalTitle: string;
  deadline: string;
  apStatus: ApStatus[];
  apWhy: boolean[];
  propStatus: PropStatus[];
  nodeSel: number;
  nodeVals: Record<string, string>;
  wfState: WfState;
  wfVer: number;
  routineOn: Record<string, boolean>;
  chatOpen: boolean;
  setupOpen: boolean;
  setupStep: number;
  setupDone: boolean;
  connState: Record<string, ConnStatus>;
  posture: Posture;
  readThread: Msg[];
  readDraft: string;
  chatMode: ChatMode;
  humanThread: Msg[];
  routineEdits: Record<string, string[]>;
  addOpen: string | null;
  profile: Profile;
  onboarded: boolean;
  obStep: number;
  obStrengths: string[];
  obBreadth: Breadth;
  obCats: string[];
  team: TeamMember[];
  budgetMo: number;
  hoursWk: number;
  /** See ObAnswered — never read a real account's budget/hours/target without checking these. */
  obAnswered: ObAnswered;
  baselineText: string;
  currency: string;
  targetNum: number;
  /** Where the goal metric is now. null = not set (an account whose goals.baseline is NULL) — never substitute the demo 28,400. */
  baselineNum: number | null;
  reinvest: Reinvest;
  /** null means the founder has not supplied a margin; it is not a zero margin. */
  marginPct: number | null;
  obMoneyOpen: boolean;
  obTeamOpen: boolean;
  website: string;
  socials: string;
  obPlatforms: string[];
  obThread: Msg[];
  obDraft: string;
  obPace: string;
  obPostureSet: Posture[];
  goalTexts: Record<string, string>;
  messages: Msg[];
  buddyText: string;
  scan: ScanState;
  narrative: NarrativeState;
  /* ---- guided first run (docs/PRODUCT-EXPERIENCE.md spine) — additive ---- */
  /** Guided step after the plan is agreed; "home" for every account that never entered the flow. Persisted. */
  setupFlow: SetupFlow;
  /** The founder chose "I'll do this later" on the Connect-your-data step (honest state, no fake connection). Persisted. */
  setupConnectLater: boolean;
  /** The founder dismissed the "Getting set up" card once all five steps were done. Persisted. */
  setupCardDismissed: boolean;
  /** plans.agreed_at as the server reports it (hydrated by the setup-progress fetch). Transient. */
  planAgreedAt: string | null;
  /** Set by "Agree the plan →": Home's plan timeline settles in on its next mount. Transient. */
  settlePlan: boolean;
  /** Set when the first routine's dry run was triggered from the guided step: the first draft card slides in. Transient. */
  firstRunPending: boolean;
}

export type Patch = Partial<PlatformState>;
export type Setter = (patch: Patch | ((s: PlatformState) => Patch)) => void;

export const initialState: PlatformState = {
  contextGeneration: 0,
  automationPaused: false,
  view: "today",
  selCat: "All",
  sel: null,
  draft: "",
  goalTitle: "NZ$40,000 MRR",
  deadline: "2026-09-30",
  apStatus: ["pending", "pending", "pending"],
  apWhy: [false, false, false],
  propStatus: ["ready", "blocked", "building"],
  nodeSel: 0,
  nodeVals: {},
  wfState: "clean",
  wfVer: 12,
  routineOn: {},
  chatOpen: false,
  setupOpen: false,
  setupStep: 0,
  setupDone: false,
  connState: {},
  posture: "brand",
  readThread: [],
  readDraft: "",
  chatMode: "ai",
  humanThread: [
    { from: "h", text: "Kia ora — Sam from the Junction team. I can see your goal, strategy and receipts (never your credentials), so you don’t need to explain from scratch. What are you wrestling with?" },
    { from: "h", text: "One nudge from this week’s account review: the welcome-flow voiceover is your biggest open lever — worth your 2 hours before anything else." },
  ],
  routineEdits: {},
  addOpen: null,
  profile: { budget: "≤ NZ$120/day", time: "6 h/wk", strength: "Writing & product", belief: "Brand before sales", team: "Just me" },
  onboarded: false,
  obStep: 0,
  obStrengths: ["Writing", "Product"],
  obBreadth: "focused",
  obCats: ["revenue"],
  team: [{ name: "You", role: "Founder", areas: ["Content", "Paid ads", "SEO", "Sales", "Email & SMS"] }],
  budgetMo: 3600,
  hoursWk: 6,
  obAnswered: { target: true, budget: true, hours: true },
  baselineText: "NZ$28,400 MRR today",
  currency: "NZD",
  targetNum: 40000,
  baselineNum: 28400,
  reinvest: "balanced",
  marginPct: 30,
  obMoneyOpen: false,
  obTeamOpen: false,
  website: "",
  socials: "",
  obPlatforms: ["Instagram"],
  obThread: [],
  obDraft: "",
  obPace: "Steady · 4 weeks",
  obPostureSet: ["brand"],
  goalTexts: {
    revenue: "NZ$40,000 MRR",
    profit: "63% blended margin",
    brand: "25k engaged followers",
    leads: "40 qualified leads/mo",
    retention: "22% repeat purchase rate",
    launch: "Launch the AU market",
  },
  messages: [
    { from: "j", text: "Morning Tom. Overnight I completed the weekly brief and staged 4 founder posts. One decision is waiting: a NZ$40/day budget shift with 3.1× expected ROAS. Want the reasoning?" },
    { from: "u", text: "Why shift budget away from Prospecting-B?" },
    { from: "j", text: "Prospecting-B’s 7-day ROAS fell to 1.4× while Advantage+ retargeting held 3.1× on the same certified revenue definition. The shift stays inside your NZ$120/day guardrail and is reversible. This comes from Daily paid decisioning — you can inspect every step.", link: "D02-W01", linkLabel: "Inspect the system →" },
  ],
  buddyText: "",
  scan: { status: "idle", key: null, profile: null },
  narrative: { status: "idle", key: null, baseKey: null, value: null },
  setupFlow: "home",
  setupConnectLater: false,
  setupCardDismissed: false,
  planAgreedAt: null,
  settlePlan: false,
  firstRunPending: false,
};

/* ---- accounts mode: the empty start (docs/PRODUCT-EXPERIENCE.md "Real only") ----
   A real account never inherits the prototype's founder: no goal, no baseline, no budget, no
   hours, no strengths, no seeded chat. The inputs show placeholders; the plan generator asks
   for what is missing. Everything that is product furniture (the catalog, the categories, the
   pace chips) stays. `initialState` above is the demo sandbox and is untouched. */

export const ACCOUNT_EMPTY_PROFILE: Profile = { budget: "", time: "", strength: "", belief: "", team: "Just me" };

/** The state a brand-new account is seeded from (and the base a partially populated one hydrates over). */
export function accountInitialState(currency: string = "USD"): PlatformState {
  return {
    ...initialState,
    goalTitle: "",
    deadline: "",
    goalTexts: {},
    targetNum: 0,
    baselineNum: null,
    baselineText: "",
    budgetMo: 0,
    hoursWk: 0,
    obAnswered: { target: false, budget: false, hours: false },
    currency,
    obStrengths: [],
    obPlatforms: [],
    marginPct: null,
    team: [],
    profile: { ...ACCOUNT_EMPTY_PROFILE },
    messages: [],
    humanThread: [],
    connState: {},
    routineOn: {},
    apStatus: [],
    apWhy: [],
    propStatus: [],
  };
}

/** Default account currency from where the founder is: the unc_country cookie (pinned by the
    proxy / ?country=) first, else the browser language's region. Only the currencies the
    onboarding offers; anything else lands on USD. Pure — the caller reads cookie / navigator. */
export function currencyForLocale(input: { country?: string | null; language?: string | null }): string {
  const byCountry: Record<string, string> = { NZ: "NZD", AU: "AUD", GB: "GBP", US: "USD" };
  const euro = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);
  const pick = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const up = code.trim().toUpperCase();
    if (byCountry[up]) return byCountry[up];
    if (euro.has(up)) return "EUR";
    return null;
  };
  const fromCookie = pick(input.country);
  if (fromCookie) return fromCookie;
  const lang = (input.language ?? "").trim();
  const region = lang.includes("-") ? lang.split("-").pop() : null;
  return pick(region) ?? "USD";
}
