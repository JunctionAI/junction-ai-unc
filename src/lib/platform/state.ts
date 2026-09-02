/* The prototype's complete state shape + demo initial state — ported verbatim from
   design-reference/platform-v2-logic.js `this.state`. Client-side only for Phase 1;
   "Skip — explore with demo data" lands straight on this dataset. */

import type { RoutineDef } from "./catalog";
import type { Posture } from "./plan";
import type { BusinessProfile } from "@/lib/unc/scan";
import type { PlanNarrative } from "@/lib/unc/narrative";

export type View = "today" | "systems" | "connectors" | "strategy";
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

export interface PlatformState {
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
  baselineText: string;
  currency: string;
  targetNum: number;
  /** Where the goal metric is now. null = not set (an account whose goals.baseline is NULL) — never substitute the demo 28,400. */
  baselineNum: number | null;
  reinvest: Reinvest;
  marginPct: number;
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
