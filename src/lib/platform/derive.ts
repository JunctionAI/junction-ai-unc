/* Port of the prototype's renderVals() — design-reference/platform-v2-logic.js.
   This is the authoritative logic; computations and copy strings are transcribed
   verbatim (nested IIFEs flattened, `this.setState` → `set`). Dynamic style values
   coming out of the logic keep the prototype's literal oklch() strings bit-for-bit;
   static styles in the JSX use the globals.css tokens. */

import { ALL_SYSTEMS, CATEGORIES, CAT_TAGLINES, CONNECTOR_DEFS, type RoutineDef } from "./catalog";
import { goalMath } from "./goal";
import { planReasoning, scoreChannels, span, weekSplit, POSTURE_WEIGHTS, type PhaseReasoning, type Posture } from "./plan";
import { postureDefs } from "./postures";
export { postureDefs };
import type { ConnStatus, NarrativeState, PlatformState, ScanState, Setter } from "./state";
import { DEFAULT_FOOTNOTE, type NarrativeRequest } from "../unc/narrative";
import { connectorHasRealSync } from "../connectors/sync";
import type { AccountFacts } from "../unc/accountFacts";
import { paidInPlan, savedPlanTimeline, realProposals } from "../setup/home";

type Ev = { target: { value: string } };
type KEv = { key: string };

const cyan = "oklch(0.78 0.13 220)";
const navy = "oklch(0.27 0.055 262)";
const activeBg = "oklch(0.36 0.06 262)";
const dim = "oklch(0.45 0.05 262)";

const stateStyle = (st: string): [string, string] =>
  st === "Active"
    ? ["oklch(0.45 0.1 240)", "oklch(0.94 0.03 225)"]
    : st === "Available"
      ? ["oklch(0.52 0.03 260)", "oklch(0.945 0.008 260)"]
      : ["oklch(0.5 0.12 75)", "oklch(0.93 0.05 80)"];

const postureLeans: Record<Posture, { skills: string[]; plats: string[] }> = {
  brand: { skills: ["Writing", "Video", "Community"], plats: ["Instagram", "TikTok", "LinkedIn"] },
  sales: { skills: ["Sales conversations", "Cold calls", "DMs & outreach"], plats: ["LinkedIn", "Email / SMS"] },
  paid: { skills: ["Paid media", "Design"], plats: ["Facebook", "Google (Search & Ads)", "TikTok"] },
};

const suggMap: Record<string, string[]> = {
  "brand.0": ["Content performance learning", "Keyword opportunity scan"],
  "brand.1": ["Abandoned cart recovery", "Campaign calendar prep"],
  "brand.2": ["Creative test planner", "Budget pacing guard"],
  "brand.3": ["Follow-up cadence", "Lead research & scoring"],
  "sales.0": ["Pipeline hygiene", "Customer-question mining"],
  "sales.1": ["Campaign calendar prep", "Welcome flow tuning"],
  "sales.2": ["Winback campaign prep", "Review request timing"],
  "sales.3": ["Founder content engine", "Keyword opportunity scan"],
  "paid.0": ["Organic-to-paid promotion", "Content gap analysis"],
  "paid.1": ["Keyword opportunity scan", "SERP position watch"],
  "paid.2": ["Welcome flow tuning", "Abandoned cart recovery"],
  "paid.3": ["Founder content engine", "Lead research & scoring"],
};

/* Demo-clock account facts (verbatim prototype copy) — lifted to module scope so the
   Unc context serializer (src/lib/unc/context.ts) can read the same numbers the UI shows. */
export const AP_DATA = [
  { sys: "D02-W01", title: "Shift NZ$40/day into Advantage+ retargeting", detail: "Prospecting-B ROAS fell to 1.4× over 7 days; retargeting holds 3.1×. Reversible, inside guardrail.", before: "NZ$60/day Prospecting-B", after: "NZ$20/day + NZ$40 retargeting", expiry: "expires in 18h" },
  { sys: "D01-W01", title: "Publish founder post “Why we stopped discounting”", detail: "Drafted from 31 customer questions. Zero first-person claims added. Scheduled for 09:00 Tuesday.", before: "Staged draft", after: "Published to LinkedIn", expiry: "expires in 2d" },
  { sys: "D05-W03", title: "Send winback to 412 lapsed customers", detail: "Zero-recipient test passed. 15% offer respects margin guardrail. Suppresses anyone emailed this week.", before: "0 recipients", after: "412 recipients, 1 send", expiry: "expires in 3d" },
];
export const AP_WHY_TEXTS = [
  "Certified 7-day ROAS: Prospecting-B 1.4×, Advantage+ 3.1× on identical revenue definitions. Reversible within a day, inside your NZ$120/day guardrail. Downside if wrong: ~NZ$40. Upside at the current spread: ~NZ$68/day.",
  "Drafted only from questions 31 customers actually asked. No first-person claims were generated — the two personal lines are quoted from your own previous posts. Tuesday 09:00 is your audience’s peak window.",
  "All 412 lapsed 60–180 days; anyone emailed this week is suppressed. The 15% offer keeps margin at 63%, above your 61% floor. Zero-recipient test passed last night — receipt R-4489.",
];
export const SIGNAL_DEFS = [
  { label: "Budget headroom", value: "NZ$54/day", delta: "of NZ$120 guardrail", deltaColor: "oklch(0.62 0.05 250)" },
  { label: "Site CVR", value: "3.1%", delta: "industry 2.8% · ahead", deltaColor: "oklch(0.78 0.13 220)" },
  { label: "Social views", value: "48.2k/wk", delta: "▲ 22% · reels working", deltaColor: "oklch(0.78 0.13 220)" },
  { label: "Email revenue", value: "9% of total", delta: "industry 22% · your gap", deltaColor: "oklch(0.75 0.14 75)" },
];
export const LEVER_DEFS = [
  { name: "Retention: winback + welcome", impact: "+NZ$2,900/mo", cost: "NZ$0 — organic", conf: "HIGH · DOING FIRST", confColor: "oklch(0.78 0.13 220)", bg: "oklch(0.32 0.06 262)", border: "oklch(0.78 0.13 220 / 0.55)" },
  { name: "Scale organic content", impact: "+NZ$1,400/mo", cost: "NZ$0 — 2h/wk of your voice", conf: "MEDIUM · RUNNING", confColor: "oklch(0.75 0.04 250)", bg: "transparent", border: "oklch(0.38 0.05 262)" },
  { name: "CRO: PDP 3.1% → 3.6%", impact: "+NZ$1,100/mo", cost: "NZ$0 — test staged", conf: "MEDIUM · QUEUED", confColor: "oklch(0.75 0.04 250)", bg: "transparent", border: "oklch(0.38 0.05 262)" },
  { name: "Scale paid +NZ$38/day", impact: "+NZ$3,300/mo", cost: "burns 70% of headroom", conf: "HOLD · UNTIL REPEAT ≥ 18%", confColor: "oklch(0.75 0.14 75)", bg: "transparent", border: "oklch(0.38 0.05 262)" },
];
export const COMPLETED_DEFS = [
  { text: "Weekly operating brief delivered — three priorities set against the repeat-purchase constraint", receipt: "Receipt R-4482" },
  { text: "4 founder posts drafted from customer questions, staged for approval", receipt: "Receipt R-4483" },
  { text: "18 leads researched and scored against ICP, 6 qualified for review", receipt: "Receipt R-4485" },
];

/* Canned Unc replies — the pre-Phase-3 behaviour, kept as the fallback when the
   live endpoint is unavailable (no key, network error, refusal). */
export const CANNED_CORNER_REPLY =
  "Understood. I’ll map that to the right system, run it read-only first, and bring you one decision with the evidence — nothing changes without your approval.";
export const CANNED_OB_REPLY =
  "Good push — folded into the draft. You’ll see it reflected in Strategy, and we keep reshaping it there as the data comes in.";

/** Live-chat sender injected by the app shell (Platform.tsx). When absent or when the
    endpoint falls back, the canned replies above are used — the chat is never dead. */
export type UncSend = (args: { surface: "corner" | "onboarding"; text: string; canned: string }) => void;

/** Which world the view model describes (docs/PRODUCT-EXPERIENCE.md "Real only").
    "demo"    — the prototype's sandbox: every value below is the prototype's, byte for byte.
    "account" — a signed-in founder: connector state defaults to disconnected (never the
                catalog's `st`), routine state to off (never the catalog's "Active"), and every
                Home strip / proposal / gamification / canned reply is either the account's own
                rows (S is the DB projection; `facts` fills gaps) or empty for the copy floor.
                The clock is real and the plan's weeks count from plans.agreed_at. */
export type DeriveMode = "demo" | "account";

export interface DeriveOptions {
  mode?: DeriveMode;
  /** The account's rows (src/lib/unc/accountFacts.ts) when in hand — receipts, approvals, connectors, routine states. */
  facts?: AccountFacts | null;
  /** The clock for accounts mode (tests pin it). */
  now?: Date;
}

const DEMO_DEADLINE_FALLBACK_WEEKS = 12;

/** "2 connected · Klaviyo needs attention" / "Nothing connected yet" — the same shape src/lib/unc/accountFacts.ts
    connectorSummary() produces, computed here from the effective card states so derive stays server-safe. */
function realConnSummary(cards: { name: string; ok: boolean; expired: boolean }[]): string {
  const ok = cards.filter((c) => c.ok);
  const attention = cards.filter((c) => c.expired);
  if (!ok.length && !attention.length) return "Nothing connected yet";
  const parts: string[] = [];
  if (ok.length) parts.push(`${ok.length} connected`);
  if (attention.length === 1) parts.push(`${attention[0].name} needs attention`);
  else if (attention.length > 1) parts.push(`${attention.length} need attention`);
  return parts.join(" · ");
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function derive(S: PlatformState, set: Setter, currentMRR?: number, uncSend?: UncSend, opts: DeriveOptions = {}) {
  const account = opts.mode === "account";
  const facts = account ? (opts.facts ?? null) : null;
  const now = opts.now ?? new Date();
  /* Accounts mode: an empty deadline is "not set" (the plan asks for it); the maths below still
     needs a finite date, so it borrows a 12-week horizon that nothing renders until it is real. */
  const deadlineForMath = S.deadline || isoDate(new Date(now.getTime() + DEMO_DEADLINE_FALLBACK_WEEKS * 6048e5));
  const gm = goalMath({
    goalTitle: S.goalTitle,
    baselineNum: S.baselineNum,
    deadline: deadlineForMath,
    currency: S.currency,
    currentMRR,
    ...(account ? { today: now, start: S.planAgreedAt ? new Date(S.planAgreedAt) : now, targetFallback: S.targetNum } : {}),
  });
  const { cur, curSym, target, pace, daysLeftN, needed, proj, gap, onTrack, fmt } = gm;

  /* ---- real state readers (accounts mode) — S is the DB projection; `facts` fills what S never touched ---- */
  const factConn = (name: string): ConnStatus | undefined => {
    const f = facts?.connectors.find((c) => c.name === name);
    if (!f) return undefined;
    if (connectorHasRealSync(f.status, f.lastSyncResult)) return "ok";
    if (f.status === "needs_reconnect" || f.status === "error") return "expired";
    return "off";
  };
  const factOn = (name: string): boolean | undefined => facts?.routineStates.find((r) => r.name === name)?.enabled;
  /** Connector card state: accounts → a real sync, or disconnected; demo → the prototype's catalog default.
      A client "ok" with no facts row (OAuth return, first read not back) is not connected. A client
      "ok" over a needs_reconnect row is the optimistic reconnect. */
  const connOf = (name: string, demoDefault: ConnStatus): ConnStatus => {
    if (!account) return S.connState[name] || demoDefault;
    const fromFacts = factConn(name);
    const fromState = S.connState[name];
    if (fromState && fromState !== "ok") return fromState;
    if (fromFacts === "ok") return "ok";
    if (fromState === "ok") {
      const f = facts?.connectors.find((c) => c.name === name);
      if (!f) return "off";
      if (f.status === "connected" && !connectorHasRealSync(f.status, f.lastSyncResult)) return "off";
      return "ok";
    }
    return fromFacts ?? "off";
  };
  /** Routine on-state: accounts → routine_states or off; demo → the catalog's "Active" default. */
  const isOn = (n: string): boolean => (account ? (S.routineOn[n] ?? factOn(n) ?? false) : (S.routineOn[n] ?? ALL_SYSTEMS.find((x) => x.name === n)?.state === "Active"));
  const klaviyoState = connOf("Klaviyo", "expired");
  const realPending = facts ? facts.approvals.length : 0;

  const nav = (v: PlatformState["view"]) => () => set({ view: v });
  const openSys = (s: RoutineDef | undefined) => {
    if (!s) return;
    set({ view: "systems", sel: s, nodeSel: 0, nodeVals: {}, wfState: "clean", setupOpen: false, setupStep: 0, setupDone: false });
  };

  const apData = AP_DATA;
  const whyTexts = AP_WHY_TEXTS;
  const demoApprovals = () => apData.map((a, i) => ({
    ...a,
    pending: S.apStatus[i] === "pending",
    approved: S.apStatus[i] === "approved",
    held: S.apStatus[i] === "held",
    receipt: `R-449${i + 1}`,
    showWhy: S.apWhy[i] && S.apStatus[i] === "pending",
    whyText: whyTexts[i],
    why: () => set((s) => ({ apWhy: s.apWhy.map((x, j) => (j === i ? !x : x)) })),
    approve: () => set((s) => ({ apStatus: s.apStatus.map((x, j) => (j === i ? "approved" : x)) })),
    hold: () => set((s) => ({ apStatus: s.apStatus.map((x, j) => (j === i ? "held" : x)) })),
  }));
  /* Accounts: the "needs you" list is the runtime's (useLiveApprovals) — the three demo cards have no render path. */
  const approvals: ReturnType<typeof demoApprovals> = account ? [] : demoApprovals();

  const cats = ["All", ...CATEGORIES.map((c) => c.name)];
  const catChips = cats.map((name) => {
    const on = S.selCat === name;
    return {
      name,
      count: name === "All" ? ALL_SYSTEMS.length : CATEGORIES.find((c) => c.name === name)!.systems.length,
      pick: () => set({ selCat: name }),
      bg: on ? navy : "white",
      color: on ? "white" : "oklch(0.4 0.04 262)",
      border: on ? navy : "oklch(0.89 0.012 260)",
    };
  });
  /** Accounts: a routine's pill is its real on/off — never the catalog's cycled STATES. */
  const stateLabel = (s: RoutineDef): string => (account ? (isOn(s.name) ? "On" : "Off") : s.state);
  const visibleSystems = ALL_SYSTEMS.filter((s) => S.selCat === "All" || s.cat === S.selCat).map((s) => {
    const [c, b] = stateStyle(account ? (isOn(s.name) ? "Active" : "Available") : s.state);
    return { ...s, state: stateLabel(s), stateColor: c, stateBg: b, open: () => openSys(s) };
  });

  const sel = S.sel;
  const selSteps = sel
    ? [
        { n: 1, title: "Resolve identity and goal", detail: "Tenant, current goal, workflow version and a deduplication key — no run happens twice.", line: true },
        { n: 2, title: "Read certified inputs", detail: `Exact sources behind ${sel.name.toLowerCase()}, checked for freshness and reconciliation.`, line: true },
        { n: 3, title: "Decide inside bounds", detail: "The versioned skill produces one bounded decision with its evidence attached.", line: true },
        { n: 4, title: "Ask when it matters", detail: "Consequential actions produce an exact before/after packet and wait for a named approver.", line: true },
        { n: 5, title: "Execute, read back, receipt", detail: "Only the approved scope runs. Junction independently verifies the result and writes the full receipt.", line: false },
      ]
    : [];
  const selState: [string, string] = sel ? stateStyle(account ? (isOn(sel.name) ? "Active" : "Available") : sel.state) : ["", ""];

  const send = () => {
    const t = S.draft.trim();
    if (!t) return;
    if (S.chatMode === "human") {
      set((s) => ({
        draft: "",
        humanThread: [
          ...s.humanThread,
          { from: "u", text: t },
          { from: "j", text: "Got it — I have your account context in front of me: goal, strategy, receipts. I’ll come back with a proper answer within a few hours, or I can book you a 20-minute strategy call. — Sam" },
        ],
      }));
    } else if (uncSend) {
      set({ draft: "" });
      uncSend({ surface: "corner", text: t, canned: CANNED_CORNER_REPLY });
    } else {
      set((s) => ({
        draft: "",
        messages: [...s.messages, { from: "u", text: t }, { from: "j", text: CANNED_CORNER_REPLY }],
      }));
    }
  };
  const msgs = S.messages.map((m) => ({
    text: m.text,
    fromUser: m.from === "u",
    fromJunction: m.from === "j",
    link: !!m.link,
    linkLabel: m.linkLabel,
    linkGo: () => {
      const s = ALL_SYSTEMS.find((x) => x.id === m.link);
      openSys(s);
    },
  }));
  const toggleChat = () => set((s) => ({ chatOpen: !s.chatOpen }));

  const pd = postureDefs[S.posture];
  const leanChip = (t: string, on: boolean) => ({ t, bg: on ? "oklch(0.94 0.03 225)" : "oklch(0.955 0.006 90)", color: on ? "oklch(0.35 0.08 240)" : "oklch(0.5 0.03 260)" });
  const postures = (["brand", "sales", "paid"] as Posture[]).map((k) => {
    const d = postureDefs[k];
    const on = S.obPostureSet.includes(k);
    const lean = postureLeans[k];
    const matches = lean.skills.filter((x) => S.obStrengths.includes(x)).length + lean.plats.filter((x) => S.obPlatforms.includes(x)).length;
    return {
      label: d.label,
      thesis: d.thesis,
      fit: d.fit,
      tag: on ? "CURRENT PLAY" : "ALTERNATIVE",
      selected: on,
      skillChips: lean.skills.map((t) => leanChip(t, S.obStrengths.includes(t))),
      platChips: lean.plats.map((t) => leanChip(t, S.obPlatforms.includes(t))),
      match: matches ? `Matches ${matches} of your picks` : "Outside your current picks",
      border: on ? "oklch(0.78 0.13 220)" : "oklch(0.91 0.01 260)",
      shadow: on ? "0 2px 16px oklch(0.78 0.13 220 / 0.22)" : "none",
      pick: () =>
        set((s) => {
          const setArr = on ? s.obPostureSet.filter((x) => x !== k) : [...s.obPostureSet, k];
          if (!setArr.length) return {};
          return { obPostureSet: setArr, posture: setArr[0] };
        }),
    };
  });

  const rKey = (i: number) => `${S.posture}.${i}`;
  const phases = pd.phases.map((ph, pi) => {
    const active = ph.st === "ACTIVE" || ph.st === "NOW" || ph.st === "WOULD ACTIVATE";
    const routines = S.routineEdits[rKey(pi)] ?? ph.routines;
    return {
      ...ph,
      border: ph.st === "NOW" ? "oklch(0.78 0.13 220 / 0.6)" : "oklch(0.91 0.01 260)",
      nBg: active ? "oklch(0.27 0.055 262)" : "oklch(0.93 0.008 260)",
      nFg: active ? "oklch(0.78 0.13 220)" : "oklch(0.55 0.03 260)",
      stColor: active ? "oklch(0.45 0.1 240)" : "oklch(0.5 0.12 75)",
      stBg: active ? "oklch(0.94 0.03 225)" : "oklch(0.93 0.05 80)",
      pillBorder: ph.st === "NOW" ? "oklch(0.78 0.13 220 / 0.7)" : active ? "oklch(0.42 0.06 250)" : "oklch(0.36 0.05 262)",
      pillColor: ph.st === "NOW" ? "oklch(0.97 0.01 90)" : active ? "oklch(0.85 0.03 250)" : "oklch(0.6 0.05 250)",
      pillDot: ph.st === "NOW" ? "oklch(0.78 0.13 220)" : active ? "oklch(0.6 0.08 235)" : "oklch(0.45 0.05 260)",
      routines: routines.map((name) => ({
        name,
        open: () => {
          const s2 = ALL_SYSTEMS.find((x) => x.name === name);
          if (s2) openSys(s2);
        },
        remove: () => set((s) => ({ routineEdits: { ...s.routineEdits, [rKey(pi)]: routines.filter((x) => x !== name) } })),
      })),
      hasSugg: (suggMap[rKey(pi)] || []).filter((n) => !routines.includes(n)).length > 0,
      suggPreview: (suggMap[rKey(pi)] || [])
        .filter((n) => !routines.includes(n))
        .slice(0, 3)
        .map((name) => ({
          name,
          open: () => {
            const s2 = ALL_SYSTEMS.find((x) => x.name === name);
            if (s2) openSys(s2);
          },
        })),
      addOpen: S.addOpen === rKey(pi),
      toggleAdd: () => set((s) => ({ addOpen: s.addOpen === rKey(pi) ? null : rKey(pi) })),
      suggestions: (suggMap[rKey(pi)] || [])
        .filter((n) => !routines.includes(n))
        .map((name) => ({
          name,
          add: () => set((s) => ({ routineEdits: { ...s.routineEdits, [rKey(pi)]: [...routines, name] }, addOpen: null })),
        })),
      count: routines.length,
      goRoutines: () => set({ view: "systems", selCat: "All", sel: null }),
    };
  });
  const routineCount = phases.reduce((acc, ph) => acc + ph.routines.length, 0);
  const nowPhase = phases.find((p) => p.st === "NOW") || phases[0];
  const nextBestSugg = nowPhase.suggestions[0];

  const effConn = (d: (typeof CONNECTOR_DEFS)[number]) => connOf(d.name, d.st);
  const connectors = CONNECTOR_DEFS.map((d) => {
    const st = effConn(d);
    return {
      ...d,
      ok: st === "ok",
      expired: st === "expired",
      off: st === "off",
      connect: () => set((s) => ({ connState: { ...s.connState, [d.name]: "ok" } })),
      disconnect: () => set((s) => ({ connState: { ...s.connState, [d.name]: "off" } })),
    };
  });
  const connSummary = account
    ? realConnSummary(connectors)
    : `${connectors.filter((c) => c.ok).length} connected · ${connectors.filter((c) => c.expired).length} needs attention · ${connectors.filter((c) => c.off).length} available`;

  type WfDef = { tag: string; name: string; desc: string; color: string; params: [string, string][] };
  /* Accounts: the detail view draws the spec's own node chain and the real version (RoutineDetail); the prototype's
     canvas, inspector and four-step wizard are demo furniture with no render path. */
  const wfDefs: WfDef[] = sel && !account
    ? [
        { tag: "TRIGGER", name: "Schedule", desc: sel.cadence, color: "oklch(0.5 0.12 75)", params: [["Cadence", sel.cadence], ["Dedup key", "tenant + goal + date"]] as [string, string][] },
        { tag: "READ", name: "Certified inputs", desc: "Shopify · GA4 · Meta", color: "oklch(0.55 0.11 235)", params: [["Sources", "Shopify, GA4, Meta Ads"], ["Freshness limit", "60 min"]] as [string, string][] },
        { tag: "CHECK", name: "Validate & reconcile", desc: "Freshness · coverage · authority", color: "oklch(0.55 0.11 235)", params: [["Reconcile tolerance", "±1.5%"], ["On failure", "block + incident"]] as [string, string][] },
        { tag: "DECIDE", name: "Skill decision", desc: "Bounded by guardrails", color: "oklch(0.45 0.1 240)", params: [["Skill version", `v${S.wfVer}`], ["Bound", `≤ NZ$${Math.round(S.budgetMo / 30)}/day`], ["KPI", sel.kpi]] as [string, string][] },
        { tag: "GATE", name: "Approval", desc: "Named approver · Tom", color: "oklch(0.5 0.12 75)", params: [["Approver", "Tom"], ["Expiry", "48 h"], ["Auto-approve", "never"]] as [string, string][] },
        { tag: "EXECUTE", name: "Execute + read back", desc: "Idempotent · rollback ready", color: "oklch(0.45 0.1 240)", params: [["Write mode", "approval_gated"], ["Rollback", "prepared per action"]] as [string, string][] },
        { tag: "RECEIPT", name: "Receipt + learning", desc: "Reads · changes · learnings", color: "oklch(0.55 0.11 235)", params: [["Receipt", "required"], ["Measurement window", "14 days"]] as [string, string][] },
      ]
    : [];
  const wfNodes = wfDefs.map((n, i) => ({
    ...n,
    tagColor: n.color,
    hasNext: i < wfDefs.length - 1,
    border: i === S.nodeSel ? "oklch(0.78 0.13 220)" : "oklch(0.89 0.012 260)",
    shadow: i === S.nodeSel ? "0 2px 14px oklch(0.78 0.13 220 / 0.3)" : "none",
    pick: () => set({ nodeSel: i }),
  }));
  const inspNode = wfDefs[S.nodeSel] || wfDefs[0] || { tag: "", name: "", color: "", params: [] as [string, string][] };
  const inspParams = inspNode.params.map(([k, dv]) => {
    const key = `${S.nodeSel}.${k}`;
    return { k, v: S.nodeVals[key] ?? dv, set: (e: Ev) => set((s) => ({ nodeVals: { ...s.nodeVals, [key]: e.target.value }, wfState: "draft" })) };
  });

  type SetupDef = { title: string; items: [string, string][]; note: string; cta: string };
  const setupDefs: SetupDef[] = account ? [] : [
    { title: "Connect the sources this system reads", items: [["Shopify", "ok"], ["GA4", "ok"], ["Klaviyo — reconnect", "warn"]] as [string, string][], note: "Least-privilege scopes only. Junction lists every scope before you approve the connection.", cta: "Sources look right" },
    { title: "Confirm your definitions", items: [["Currency · NZD", "ok"], ["Timezone · Pacific/Auckland", "ok"], ["Attribution · last non-direct", "ok"], ["Revenue · net of refunds", "ok"]] as [string, string][], note: "These certify every number the system reads and reports.", cta: "Definitions confirmed" },
    { title: "What Junction needs from you", items: [["Owner · Tom", "ok"], ["3 examples in your voice", "warn"], ["Guardrail · ≤ 2 emails/wk", "ok"], ["Approval · every consequential action", "ok"]] as [string, string][], note: "Your taste and first-person claims stay yours — Junction drafts, you approve.", cta: "Provided — keep going" },
    { title: "Dry run tonight", items: [["Zero recipients", "ok"], ["Full receipt", "ok"]] as [string, string][], note: "Runs against live reads with zero outward actions. Results land in Home with the receipt before anything activates.", cta: "Start dry run" },
  ];
  const setupSteps = setupDefs.map((d, i) => {
    const done = i < S.setupStep;
    const active = i === S.setupStep;
    return {
      title: d.title,
      note: d.note,
      cta: d.cta,
      active,
      line: i < 3,
      mark: done ? "✓" : String(i + 1),
      cBg: done ? "oklch(0.78 0.13 220)" : active ? "oklch(0.27 0.055 262)" : "oklch(0.93 0.008 260)",
      cFg: done ? "oklch(0.22 0.05 262)" : active ? "oklch(0.78 0.13 220)" : "oklch(0.55 0.03 260)",
      tColor: done || active ? "oklch(0.27 0.05 262)" : "oklch(0.58 0.02 260)",
      items: d.items.map(([t, st2]) => ({
        t,
        border: st2 === "ok" ? "oklch(0.88 0.015 260)" : "oklch(0.8 0.09 75)",
        color: st2 === "ok" ? "oklch(0.35 0.05 262)" : "oklch(0.45 0.11 70)",
        bg: st2 === "ok" ? "white" : "oklch(0.93 0.05 80)",
      })),
      next: () => (i === 3 ? set({ setupOpen: false, setupDone: true }) : set({ setupStep: i + 1 })),
    };
  });

  /* ---- home plan / setup / gamification / bar (flattened from the prototype's IIFE) ---- */
  const homeChans = scoreChannels(S.posture, S.obStrengths || [], S.budgetMo);
  const { weeksLeft, w1, w2end } = weekSplit(deadlineForMath);
  const homeRest = homeChans.slice(2).map((c) => c.k).join(" + ");
  const gapLeft = Math.max(0, target - cur);
  const reinvestPct = ({ steady: "25%", balanced: "40%", aggressive: "60%" } as const)[S.reinvest];
  const dayBudget = Math.round(S.budgetMo / 30);
  // Faithful to the prototype: `chans.slice(0,2).some(c => c.k === 'Paid ads') || true` — always true.
  // Accounts: only when paid media really is in the first two phases of the founder's plan.
  const hasPaid = account ? paidInPlan(S) : homeChans.slice(0, 2).some((c) => c.k === "Paid ads") || true;

  const homePlain = onTrack
    ? `You need ${fmt(gapLeft)} more by the deadline. Right now you’re on pace. Keep clearing your part below.`
    : `You need ${fmt(gapLeft)} more by the deadline. You’re a little behind — the plan below closes the gap. Your part is below.`;
  type HomePlanDef = { weeks: string; title: string; focus: string; on: boolean; st: string };
  /* Accounts: persisted phases only; elapsed time cannot establish execution progress. */
  const homePlanDefs: HomePlanDef[] = account
    ? savedPlanTimeline(facts?.plan ?? null, S.automationPaused).map((p) => ({ weeks: p.weeks, title: p.title, focus: p.focus, on: p.on, st: p.st }))
    : [
        { weeks: span(1, w1), title: `${homeChans[0].k} — your strength, running first`, focus: "Get the engine working. You: taste + okays.", on: true, st: "Now" },
        { weeks: span(w1 + 1, w2end), title: `Add ${homeChans[1].k.toLowerCase()}`, focus: "Turn momentum into revenue. You: a few okays a day.", on: false, st: "Next" },
        { weeks: `${span(w2end + 1, weeksLeft)}+`, title: homeRest, focus: "Switch on as the numbers earn it.", on: false, st: "Later" },
      ];
  const homePlan = homePlanDefs.map((p) => ({
    ...p,
    border: p.on ? "oklch(0.78 0.13 220 / 0.6)" : "oklch(0.91 0.01 260)",
    weekColor: p.on ? "oklch(0.45 0.1 240)" : "oklch(0.6 0.02 260)",
    stColor: p.on ? "oklch(0.45 0.1 240)" : "oklch(0.55 0.03 260)",
    stBg: p.on ? "oklch(0.94 0.03 225)" : "oklch(0.945 0.008 260)",
  }));

  const okN = CONNECTOR_DEFS.filter((d) => effConn(d) === "ok").length;
  const allOk = CONNECTOR_DEFS.every((d) => effConn(d) === "ok");
  type HomeSetupDef = { title: string; done: boolean; action: string | undefined; note: string | undefined; go: (() => void) | undefined };
  /* Accounts: the "Getting set up" card (GettingSetUp.tsx, real spine states) replaces this strip — its hardcoded
     "History imported / Site & socials scanned / Numbers certified" flags have no render path. */
  const homeSetupDefs: HomeSetupDef[] = account
    ? []
    : [
        { title: "Platforms connected", done: allOk, action: `${okN} of ${CONNECTOR_DEFS.length} — connect more`, note: undefined, go: () => set({ view: "connectors" }) },
        { title: "History imported", done: true, action: undefined, note: "orders, spend, sends — in one warehouse", go: undefined },
        { title: "Site & socials scanned", done: true, action: undefined, note: "your voice, offers and market — read", go: undefined },
        { title: "Numbers certified", done: false, action: undefined, note: "cross-checked against your sources nightly", go: undefined },
      ];
  const homeSetup = homeSetupDefs.map((x) => ({
    ...x,
    mark: x.done ? "✓" : "·",
    hasAction: !!x.action,
    hasNote: !!x.note,
    border: x.done ? "oklch(0.91 0.01 260)" : "oklch(0.78 0.13 220 / 0.55)",
    mBg: x.done ? "oklch(0.78 0.13 220)" : "oklch(0.94 0.03 225)",
    mFg: x.done ? "oklch(0.22 0.05 262)" : "oklch(0.45 0.1 240)",
  }));

  const onCount = ALL_SYSTEMS.filter((s2) => isOn(s2.name)).length;
  const gamTotalN = ALL_SYSTEMS.length;
  /* Accounts: hours saved come from real runs (telemetry — hoursSavedLabel), never 2.5 h × routines; the rank ladder is demo copy. */
  const hrs = account ? 0 : Math.round(onCount * 2.5);
  const pct = Math.round((onCount / gamTotalN) * 100);
  const rank = account ? `${pct}%` : onCount >= 18 ? "Fully OP" : onCount >= 12 ? "Operator" : onCount >= 6 ? "Builder" : "Getting started";
  const withTeam = S.team.filter((p) => (p.areas || []).length && p.name && p.name !== "You").length;
  const gamCats = CATEGORIES.map((c) => {
    const on = c.systems.filter(isOn).length;
    const full = on === c.systems.length;
    return {
      name: c.name,
      dots: c.systems.map((n) => ({ bg: isOn(n) ? "oklch(0.72 0.17 150)" : "oklch(0.92 0.008 260)" })),
      sub: full ? "Complete ✓" : `${on}/${c.systems.length} · ${c.systems.length - on} to unlock`,
      subColor: full ? "oklch(0.55 0.15 150)" : "oklch(0.52 0.03 260)",
      open: () => set({ view: "systems", selCat: c.name, sel: null }),
    };
  });
  const gamHireLine =
    withTeam > 0
      ? `Your team covers ${withTeam} approval area${withTeam === 1 ? "" : "s"} — decisions there skip you entirely. Hand off the rest and the machine barely needs you.`
      : account
        ? "Put a teammate in charge of an area’s approvals (Strategy → team) and its decisions skip you entirely."
        : `Pro move: put a teammate in charge of an area’s approvals (Strategy → team) and its decisions skip you entirely — that’s another ~${Math.max(2, Math.round(hrs * 0.4))} h/week back.`;

  type HomeBarDef = { what: string; bar: string; proof: string; behind: boolean; fixLabel: string | undefined; fix: (() => void) | undefined };
  /* Accounts: the bar is barCards(telemetry) — published benchmarks or "Industry reference — not yet from Junction accounts" / "Not measured yet". */
  const homeBarDefs: HomeBarDef[] = account ? [] : [
    { what: "Content output", bar: "5 posts / week", proof: "What DTC brands at your target ship — you’re at 3. I’ll draft the extra two; you just okay them.", behind: true, fixLabel: "Queue 2 more drafts / week", fix: () => set({ view: "systems", selCat: "Content", sel: null }) },
    { what: "Repeat purchase", bar: "22% of customers", proof: "The category norm at NZ$40k MRR — you’re at 14%. Winback + welcome flows close most of this gap.", behind: true, fixLabel: "Switch on the flows", fix: () => set({ view: "systems", selCat: "Email & SMS", sel: null }) },
    { what: "Response speed", bar: "< 4 h to leads", proof: "Businesses that hit goals like yours reply same-morning. You’re already there.", behind: false, fixLabel: undefined, fix: undefined },
  ];
  const homeBar = homeBarDefs.map((x) => ({ ...x, status: x.behind ? "Below the bar" : "At the bar ✓", okColor: x.behind ? "oklch(0.5 0.12 75)" : "oklch(0.55 0.15 150)" }));

  const homeAdsLine = `Ad spend starts at ${curSym}${dayBudget}/day and only grows from wins: about ${reinvestPct} of new profit rolls back in, so the budget scales itself as the goal gets closer.`;

  /* ---- onboarding plan generation (flattened) ---- */
  const obChans = scoreChannels(S.posture, S.obStrengths || [], S.budgetMo);
  const obFirst = obChans[0];
  const obSecond = obChans[1];
  const obRest = obChans.slice(2).map((c) => c.k).join(", ");
  /* plan.ts §Reasoning for the three phases (phase 3 = the first of the rest), from the founder's
     own answers — hours only once answered, the business type only once scanned. The step-6 card
     renders it collapsed under each phase and the narrative may fold each gate into its note. */
  const obReasoning = planReasoning({
    posture: S.posture,
    strengths: S.obStrengths || [],
    budgetMo: S.budgetMo,
    hoursWk: S.obAnswered.hours ? S.hoursWk : null,
    businessType: S.scan.status === "done" ? (S.scan.profile?.businessType ?? null) : null,
    currencySymbol: curSym,
  });
  const obPhaseReasoning: PhaseReasoning[] = [obFirst.k, obSecond.k, obChans[2]?.k ?? obSecond.k].map((k) => obReasoning.byChannel[k]);
  const obNarrativeReasoning = obPhaseReasoning.map((r) => ({ whyThisOrder: r.whyThisOrder, evidenceGate: r.evidenceGate, risk: r.risk }));
  const obPlanStep1 = `${span(1, w1)}: our world-class ${obFirst.k.toLowerCase()} routines, built around what you do best. Focus: a working engine — drafts flowing, your taste applied, first wins on the board.`;
  const obPlanStep2 = `${span(w1 + 1, w2end)}: we add ${obSecond.k.toLowerCase()} — ${obSecond.why}. Focus: converting the momentum into revenue.`;
  const obPlanStep3 = `${span(w2end + 1, weeksLeft)} and beyond: ${obRest} switch on as their numbers earn it. Focus: scaling what’s proven, straight through your goal.`;
  const obSummaryTitle = `${S.obPostureSet.map((k) => postureDefs[k].label).join(" + ")}, ${S.obBreadth === "broad" ? "run broad across channels" : "focused where you’re strongest"}`;
  const obDeadlineLabel = S.deadline ? new Date(S.deadline + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "";
  /* Accounts: no plan on empty inputs — Unc asks for what is missing before he drafts anything (step 6). Demo is always ready. */
  const obMissing: { step: number; label: string }[] = account
    ? [
        ...(S.obAnswered.target && S.targetNum > 0 && S.goalTitle.trim() ? [] : [{ step: 1, label: "your goal number" }]),
        ...(S.deadline ? [] : [{ step: 1, label: "a deadline" }]),
        ...(S.obAnswered.budget ? [] : [{ step: 3, label: "your growth budget (0 is a fine answer)" }]),
        ...(S.obAnswered.hours ? [] : [{ step: 3, label: "your hours a week" }]),
      ]
    : [];
  const obPlanReady = obMissing.length === 0;
  const obGap = Math.max(0, S.targetNum - (S.baselineNum ?? 0));
  const obPlanShort = `Your goal needs ${fmt(obGap)} of new ground by ${obDeadlineLabel}. With ${curSym}${Math.round(S.budgetMo / 30)}/day and ${S.hoursWk} h/wk of you, here’s the shortest path I can see:`;
  /* Everything Unc may write the step-6 prose from — the deterministic plan is fixed, the narrative only wraps it. */
  const obNarrativeRequest: NarrativeRequest = {
    goal: { title: S.goalTitle, deadline: S.deadline, deadlineLabel: obDeadlineLabel, currency: S.currency, currencySymbol: curSym, target: S.targetNum, baseline: S.baselineNum ?? 0, gap: obGap, gapLabel: fmt(obGap), otherGoals: S.obCats.slice(1).map((k) => S.goalTexts[k]).filter(Boolean) },
    resources: { budgetPerMonth: S.budgetMo, budgetPerDay: Math.round(S.budgetMo / 30), hoursPerWeek: S.hoursWk, strengths: S.obStrengths, platforms: S.obPlatforms, postures: S.obPostureSet.map((k) => postureDefs[k].label), breadth: S.obBreadth, team: S.team.map((t) => ({ name: t.name, role: t.role })) },
    plan: {
      title: obSummaryTitle,
      mathLine: obPlanShort,
      footnote: DEFAULT_FOOTNOTE,
      weeksTotal: weeksLeft,
      phases: [
        { n: 1, spanLabel: span(1, w1), channel: obFirst.k, why: obFirst.why, text: obPlanStep1, reasoning: obNarrativeReasoning[0] },
        { n: 2, spanLabel: span(w1 + 1, w2end), channel: obSecond.k, why: obSecond.why, text: obPlanStep2, reasoning: obNarrativeReasoning[1] },
        { n: 3, spanLabel: `${span(w2end + 1, weeksLeft)} and beyond`, channel: obRest, why: "switch on as their numbers earn it", text: obPlanStep3, reasoning: obNarrativeReasoning[2] },
      ],
    },
    profile: S.scan.status === "done" ? S.scan.profile : null,
  };

  const obVolume = (() => {
    const plats = S.obBreadth === "broad" ? Math.max(3, S.obPlatforms.length) : Math.min(2, Math.max(1, S.obPlatforms.length));
    const posts = Math.max(3, Math.min(14, Math.round(S.hoursWk * 1.5)));
    const day = Math.round(S.budgetMo / 30);
    if (S.posture === "sales") return `Doing the maths on your goal: I’d aim for roughly ${Math.max(10, S.hoursWk * 4)} researched leads a week, with ${Math.max(2, Math.round(S.hoursWk / 2))} hours of your conversations booked against them. Later I’d expect us to add content and email behind the pipeline.`;
    if (S.posture === "paid") return `Doing the maths on your budget: NZ$${day}/day supports about ${Math.max(2, Math.round(S.budgetMo / 900))} creative tests a month — enough to find winners without burning the budget on guesses. Later I’d expect us to add landing-page tests and email behind the ads.`;
    return `Doing the maths on your goal and hours: I’d aim for about ${posts} posts a week across ${plats} platform${plats > 1 ? "s" : ""} — I draft from real customer questions, you give it your voice. Later I’d expect us to add email and reviews behind the content.`;
  })();

  /* Accounts: a decision waits when the runtime says so; Klaviyo only counts when its row really needs a reconnect. */
  const klaviyoDown = account ? klaviyoState === "expired" : klaviyoState !== "ok";
  const simpleRead = (() => {
    const idx = phases.indexOf(nowPhase) + 1;
    const play = S.obPostureSet.map((k) => postureDefs[k].label).join(" + ").toLowerCase();
    const needsN = account ? realPending + (klaviyoDown ? 1 : 0) : S.apStatus.filter((x) => x === "pending").length + (klaviyoDown ? 1 : 0);
    if (account) {
      const onN = onCount;
      const waiting = needsN === 0 ? "nothing is waiting on you" : `${needsN === 1 ? "one thing" : `${needsN} things`} waiting on you`;
      return onN === 0 ? `Nothing running yet — turn on your first routine and I’ll have a draft within the hour. Right now ${waiting}.` : `${onN} of ${ALL_SYSTEMS.length} routines on; ${waiting}.`;
    }
    const needs = needsN === 0 ? "nothing is waiting on you right now" : `it needs ${needsN === 1 ? "one thing" : `${needsN} things`} only you can do, waiting below`;
    return onTrack
      ? `On pace for ${fmt(target)} — ${nowPhase.name.toLowerCase()} is carrying it. This week ${needs}. Running ${routineCount} of ${ALL_SYSTEMS.length} core routines — room to expand when you’re ready.`
      : `You’re in ${nowPhase.name.toLowerCase()} — phase ${idx} of your ${play} plan. At today’s pace you land ${fmt(gap)} short of ${fmt(target)}. The plan closes that, but this week ${needs}. Running ${routineCount} of ${ALL_SYSTEMS.length} core routines; expand or revisit the strategy any time.`;
  })();

  const needsCount = account ? realPending + (klaviyoDown ? 1 : 0) : S.apStatus.filter((x) => x === "pending").length + (klaviyoDown ? 1 : 0);

  const obSendImpl = () => {
    const t = S.obDraft.trim();
    if (!t) return;
    if (uncSend) {
      set({ obDraft: "" });
      uncSend({ surface: "onboarding", text: t, canned: CANNED_OB_REPLY });
    } else {
      set((s) => ({
        obDraft: "",
        obThread: [...s.obThread, { from: "u", text: t }, { from: "j", text: CANNED_OB_REPLY }],
      }));
    }
  };
  const readSendImpl = () => {
    const t = S.readDraft.trim();
    if (!t) return;
    set((s) => ({
      readDraft: "",
      readThread: [...s.readThread, { from: "u", text: t }, { from: "j", text: "Noted — logged against today’s read and weighted into tomorrow’s. If it changes the ranking, the plan adjusts and you’ll see exactly why." }],
    }));
  };

  const currencySym = (c: string) => (c === "NZD" ? "NZ$" : c === "USD" ? "US$" : c === "AUD" ? "A$" : c === "GBP" ? "£" : "€");

  return {
    wfNodes,
    contextGeneration: S.contextGeneration ?? 0,
    accountId: facts?.accountId ?? null,
    inspParams,
    inspTag: inspNode.tag,
    inspName: inspNode.name,
    inspColor: inspNode.color,
    wfVersion: account ? "" : S.wfState === "clean" ? `v${S.wfVer} · active` : S.wfState === "draft" ? `v${S.wfVer + 1} · draft` : `v${S.wfVer + 1} · validated`,
    wfVerColor: S.wfState === "draft" ? "oklch(0.45 0.11 70)" : "oklch(0.45 0.1 240)",
    wfVerBg: S.wfState === "draft" ? "oklch(0.93 0.05 80)" : "oklch(0.94 0.03 225)",
    wfDraft: S.wfState !== "clean",
    wfCanValidate: S.wfState === "draft",
    wfValidated: S.wfState === "validated",
    wfDraftMsg: account
      ? ""
      : S.wfState === "validated"
        ? "Validation passed on demonstration data — promote when you’re ready. The previous version stays available for rollback."
        : `Edits create version v${S.wfVer + 1} (draft). Junction validates it against this system’s acceptance tests before it can run in production.`,
    wfValidate: () => set({ wfState: "validated" }),
    wfPromote: () => set((s) => ({ wfState: "clean" as const, wfVer: s.wfVer + 1 })),
    setupIdle: !S.setupOpen && !S.setupDone,
    setupOn: S.setupOpen,
    setupDone: S.setupDone,
    setupSteps,
    setupProgress: account ? "" : `step ${Math.min(S.setupStep + 1, 4)} of 4 · dry-run before anything goes live`,
    openSetup: () => set({ setupOpen: true, setupStep: 0 }),
    isOnboarding: !S.onboarded,
    notOnboarding: S.onboarded,
    ob0: S.obStep === 0,
    ob1: S.obStep === 1,
    ob2: S.obStep === 2,
    ob3: S.obStep === 3,
    ob4: S.obStep === 4,
    ob5: S.obStep === 5,
    ob6: S.obStep === 6,
    obMid: S.obStep >= 1 && S.obStep <= 5,
    obDots: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ w: i === S.obStep ? "26px" : "10px", bg: i <= S.obStep ? "oklch(0.78 0.13 220)" : "oklch(0.88 0.015 260)" })),
    obGoalCats: ([
      ["revenue", "Revenue", "NZ$40k MRR"],
      ["profit", "Profit", "63% blended margin"],
      ["brand", "Brand", "25k engaged followers"],
      ["leads", "Leads", "40 qualified leads/mo"],
      ["retention", "Customer retention", "22% repeat rate"],
      ["launch", "New product", "enter AU by November"],
    ] as [string, string, string][]).map(([k, label, ex]) => {
      const on = S.obCats.includes(k);
      return {
        label,
        ex,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.89 0.012 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        toggle: () =>
          set((s) => {
            const cats2 = on ? s.obCats.filter((x) => x !== k) : [...s.obCats, k];
            if (!cats2.length) return {};
            return { obCats: cats2, goalTitle: s.goalTexts[cats2[0]] ?? "" };
          }),
      };
    }),
    obBaseline: S.baselineText,
    onObBaseline: (e: Ev) => set({ baselineText: e.target.value }),
    obMetricLabel:
      ({ revenue: "Target MRR", profit: "Target margin %", brand: "Target followers", leads: "Target leads / mo", retention: "Target repeat %", launch: "Days to launch" } as Record<string, string>)[S.obCats[0]] || "Target",
    obIsMoney: S.obCats[0] === "revenue" || S.obCats[0] === "profit",
    obTargetNum: S.targetNum,
    onObTargetNum: (e: Ev) => {
      const raw = e.target.value.trim();
      const v = +raw || 0;
      set((s) => {
        if (!account) {
          return {
            targetNum: v,
            goalTexts: { ...s.goalTexts, [s.obCats[0]]: s.obCats[0] === "revenue" ? `${currencySym(s.currency)}${v.toLocaleString()} MRR` : `${v}` },
            goalTitle: s.obCats[0] === "revenue" ? `${currencySym(s.currency)}${v.toLocaleString()} MRR` : s.goalTitle,
          };
        }
        /* Accounts: the goal line is written from the number for every category (the demo's example titles never seed it). */
        const cat = s.obCats[0];
        const title =
          raw === ""
            ? ""
            : cat === "revenue"
              ? `${currencySym(s.currency)}${v.toLocaleString()} MRR`
              : cat === "profit"
                ? `${v}% blended margin`
                : cat === "brand"
                  ? `${v.toLocaleString()} engaged followers`
                  : cat === "leads"
                    ? `${v} qualified leads/mo`
                    : cat === "retention"
                      ? `${v}% repeat purchase rate`
                      : `${v} days to launch`;
        return { targetNum: v, obAnswered: { ...s.obAnswered, target: raw !== "" }, goalTexts: { ...s.goalTexts, [cat]: title }, goalTitle: title };
      });
    },
    /** Accounts: the inputs render empty until the founder types (placeholders only — never a pre-filled number). */
    obTargetSet: S.obAnswered.target,
    obBudgetSet: S.obAnswered.budget,
    obHoursSet: S.obAnswered.hours,
    obBaselineNum: S.baselineNum,
    onObBaselineNum: (e: Ev) => {
      // an empty field is "not set" (null), never 0 — a real 0 is typed as 0
      const raw = e.target.value.trim();
      const v = raw === "" ? null : +raw || 0;
      set({ baselineNum: v, baselineText: v === null ? "" : `${v}` });
    },
    obCurrencies: ["NZD", "AUD", "USD", "GBP", "EUR"].map((code) => {
      const on = S.currency === code;
      return {
        code,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        color: on ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
        pick: () => set({ currency: code }),
      };
    }),
    obGoalDefs: S.obCats.map((k, i) => ({
      text: S.goalTexts[k],
      tag: i === 0 ? "Governing" : "Checkpoint",
      tagColor: i === 0 ? "oklch(0.45 0.1 240)" : "oklch(0.55 0.03 260)",
      set: (e: Ev) => set((s) => ({ goalTexts: { ...s.goalTexts, [k]: e.target.value }, ...(i === 0 ? { goalTitle: e.target.value } : {}) })),
    })),
    obLevers: (() => {
      const levers: Record<string, string> = {
        revenue: "traffic × conversion × repeat × price — I find which one is binding and work it first",
        profit: "margin mix, discount discipline, CAC efficiency, retention over acquisition",
        brand: "a consistent founder voice, doubling down on format winners, distribution cadence, community",
        leads: "ICP clarity, the channels that actually reach them, the offer, follow-up speed",
        retention: "lifecycle flows, post-purchase experience, winback timing, reviews",
        launch: "sequenced awareness, a waitlist engine, launch-week systems, PR moments",
      };
      const first = S.obCats[0];
      return `Main levers here: ${levers[first]}. I’ll draft the strategy around them — you steer it at the end and any time after.${S.obCats.length > 1 ? " Your other goals become checkpoints: the governing goal never gets to sacrifice them." : ""}`;
    })(),
    obNext: () => set((s) => ({ obStep: Math.min(6, s.obStep + 1) })),
    obBack: () => set((s) => ({ obStep: Math.max(0, s.obStep - 1) })),
    obFinish: () =>
      set((s) => ({
        onboarded: true,
        view: "today" as const,
        profile: { ...s.profile, belief: s.obPostureSet.map((k) => ({ brand: "Brand before sales", sales: "Sales conversations first", paid: "Buy learning fast" })[k]).join(" + ") },
        /* Guided first run (accounts mode reads these; demo mode ignores them and lands on Home as before). */
        setupFlow: "connect" as const,
        settlePlan: true,
      })),
    /* Step 2 "What platforms do you currently use?" — accounts: the answer is a FACT about the
       founder (resource_profiles.known_platforms), never a connection; the guided Connect step
       offers exactly these. Demo keeps the prototype's flip-to-connected behaviour. */
    obConns: CONNECTOR_DEFS.slice(0, 10).map((d) => {
      const on = account ? S.obPlatforms.includes(d.name) || effConn(d) === "ok" : effConn(d) === "ok";
      return {
        label: on ? `✓ ${d.name}` : d.name,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        color: on ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
        toggle: () =>
          account
            ? set((s) => ({ obPlatforms: on ? s.obPlatforms.filter((x) => x !== d.name) : [...s.obPlatforms, d.name] }))
            : set((s) => ({ connState: { ...s.connState, [d.name]: on ? "off" : ("ok" as const) } })),
      };
    }),
    /** Record a platform the founder named outside the chips (the guided step's email question) — known_platforms, idempotent. */
    addKnownPlatform: (name: string, replacing: string[] = []) => set((s) => ({ obPlatforms: [...s.obPlatforms.filter((x) => x !== name && !replacing.includes(x)), name] })),
    obConnCount: CONNECTOR_DEFS.filter((d) => effConn(d) === "ok").length,
    obStrengthChips: ["Writing", "Video", "Design", "Sales conversations", "Cold calls", "DMs & outreach", "Email", "Paid media", "SEO", "Community", "Product"].map((t) => {
      const on = S.obStrengths.includes(t);
      return {
        t,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        color: on ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
        toggle: () =>
          set((s) => ({
            obStrengths: on ? s.obStrengths.filter((x) => x !== t) : [...s.obStrengths, t],
            profile: { ...s.profile, strength: (on ? s.obStrengths.filter((x) => x !== t) : [...s.obStrengths, t]).join(" & ") || (account ? "" : "Writing & product") },
          })),
      };
    }),
    obPlatformChips: ["Instagram", "TikTok", "LinkedIn", "Facebook", "YouTube", "X", "Google (Search & Ads)", "Bing", "Pinterest", "Reddit", "Email / SMS", "Other"].map((t) => {
      const on = S.obPlatforms.includes(t);
      return {
        t,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        color: on ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
        toggle: () => set((s) => ({ obPlatforms: on ? s.obPlatforms.filter((x) => x !== t) : [...s.obPlatforms, t] })),
      };
    }),
    obFocused: () => set({ obBreadth: "focused" }),
    obBroad: () => set({ obBreadth: "broad" }),
    focBorder: S.obBreadth === "focused" ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
    focBg: S.obBreadth === "focused" ? "oklch(0.94 0.03 225)" : "white",
    focColor: S.obBreadth === "focused" ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
    broBorder: S.obBreadth === "broad" ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
    broBg: S.obBreadth === "broad" ? "oklch(0.94 0.03 225)" : "white",
    broColor: S.obBreadth === "broad" ? "oklch(0.35 0.08 240)" : "oklch(0.4 0.04 262)",
    obBudgetMo: S.budgetMo,
    obBudgetLabel: account && !S.obAnswered.budget ? "Not set yet" : `${curSym}${S.budgetMo.toLocaleString("en-NZ")}/mo`,
    obBudgetDay: `${curSym}${Math.round(S.budgetMo / 30)}`,
    obBudgetMin: `${curSym}0`,
    obBudgetMax: `${curSym}20k/mo`,
    onObBudget: (e: Ev) => {
      const v = +e.target.value;
      set((s) => ({ budgetMo: v, obAnswered: { ...s.obAnswered, budget: true }, profile: { ...s.profile, budget: `≤ ${curSym}${Math.round(v / 30)}/day` } }));
    },
    /** Accounts: the typed-number path. An empty field is "not set" (never 0 — a real 0 is typed as 0). */
    onObBudgetNum: (e: Ev) => {
      const raw = e.target.value.trim();
      const v = raw === "" ? 0 : Math.max(0, +raw || 0);
      set((s) => ({ budgetMo: v, obAnswered: { ...s.obAnswered, budget: raw !== "" }, profile: { ...s.profile, budget: raw === "" ? "" : `≤ ${curSym}${Math.round(v / 30)}/day` } }));
    },
    onObHoursNum: (e: Ev) => {
      const raw = e.target.value.trim();
      const v = raw === "" ? 0 : Math.max(0, +raw || 0);
      set((s) => ({ hoursWk: v, obAnswered: { ...s.obAnswered, hours: raw !== "" }, profile: { ...s.profile, time: raw === "" ? "" : `${v} h/wk` } }));
    },
    obHoursWk: S.hoursWk,
    obHoursLabel: account && !S.obAnswered.hours ? "Not set yet" : `${S.hoursWk} h/wk`,
    obHoursNote: account && !S.obAnswered.hours
      ? "Roughly is fine — I shape the plan around whatever you can give it."
      : S.hoursWk < 4
        ? "Approvals only — I draft everything, you decide."
        : S.hoursWk <= 10
          ? "Time spent on taste and approvals."
          : S.hoursWk <= 40
            ? "Enough to own a channel yourself — I’ll build the machine around it."
            : "A full-time growth push — I’ll run like a whole department around you.",
    onObHours: (e: Ev) => {
      const v = +e.target.value;
      set((s) => ({ hoursWk: v, obAnswered: { ...s.obAnswered, hours: true }, profile: { ...s.profile, time: `${v} h/wk` } }));
    },
    homePlain,
    homePlan,
    homeSetup,
    gamOnCount: onCount,
    gamTotal: gamTotalN,
    gamHrs: hrs,
    gamPct: `${pct}%`,
    gamRank: rank,
    gamCats,
    gamHireLine,
    homeBar,
    homeAds: hasPaid,
    homeAdsLine,
    obWebsite: S.website,
    onObWebsite: (e: Ev) => set({ website: e.target.value }),
    obSocials: S.socials,
    onObSocials: (e: Ev) => set({ socials: e.target.value }),
    obPlanShort: account && !obPlanReady ? "" : obPlanShort,
    /* Accounts: the plan generator's gate — what Unc still needs before he drafts (step 6 asks; nothing is generated on empty inputs). */
    obPlanReady,
    obMissing,
    obGoToStep: (step: number) => set({ obStep: Math.max(0, Math.min(6, step)) }),
    obPlanStep1,
    obPlanStep2,
    obPlanStep3,
    obScan: S.scan,
    obSetScan: (scan: ScanState) => set({ scan }),
    obNarrative: S.narrative,
    obSetNarrative: (narrative: NarrativeState) => set({ narrative }),
    obNarrativeRequest,
    /** plan.ts §Reasoning per step-6 phase (Why this order · What flips it · The risk · weekly), same source as Strategy's. */
    obPhaseReasoning,
    obToggleMoney: () => set((s) => ({ obMoneyOpen: !s.obMoneyOpen })),
    obMoneyOpen: S.obMoneyOpen,
    /* Not defined in the prototype's renderVals (markup references it) — mirrored from obTeamChevron. */
    obMoneyChevron: S.obMoneyOpen ? "▾" : "▸",
    obTeamOpen: S.obTeamOpen,
    obTeamChevron: S.obTeamOpen ? "▾" : "▸",
    obToggleTeam: () => set((s) => ({ obTeamOpen: !s.obTeamOpen })),
    obMargin: S.marginPct ?? 0,
    obMarginLabel: S.marginPct === null ? "Not set" : `${S.marginPct}%`,
    onObMargin: (e: Ev) => set({ marginPct: Math.max(0, Math.min(90, +e.target.value || 0)) }),
    obReinvest: ([
      ["steady", "Steady", "20–30%"],
      ["balanced", "Balanced", "30–50%"],
      ["aggressive", "All-in", "50–70%"],
    ] as ["steady" | "balanced" | "aggressive", string, string][]).map(([k, label, pctLabel]) => {
      const on = S.reinvest === k;
      return {
        label,
        pct: pctLabel,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.87 0.015 260)",
        bg: on ? "oklch(0.94 0.03 225)" : "white",
        pick: () => set({ reinvest: k }),
      };
    }),
    obReinvestNote: ({
      steady: "Keep most profit as cash — growth stays inside the base budget. Good when cash flow is tight.",
      balanced: "The sweet spot for most growing businesses — the budget above is the floor, and wins compound it.",
      aggressive: "Chasing speed — most new profit rolls straight back in. I’ll flag it if cash cover drops below 3 months.",
    } as const)[S.reinvest],
    obTeam: S.team.map((p, i) => ({
      name: p.name,
      role: p.role,
      areas: ["Content", "Paid ads", "SEO", "Sales", "Email & SMS"].map((t) => {
        const on = (p.areas || []).includes(t);
        return {
          t,
          border: on ? "oklch(0.78 0.13 220)" : "oklch(0.89 0.012 260)",
          bg: on ? "oklch(0.94 0.03 225)" : "white",
          color: on ? "oklch(0.35 0.08 240)" : "oklch(0.5 0.03 260)",
          toggle: () => set((s) => ({ team: s.team.map((x, j) => (j === i ? { ...x, areas: on ? (x.areas || []).filter((a) => a !== t) : [...(x.areas || []), t] } : x)) })),
        };
      }),
      setName: (e: Ev) => set((s) => ({ team: s.team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })),
      setRole: (e: Ev) => set((s) => ({ team: s.team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })),
      remove: () => set((s) => ({ team: s.team.length > 1 ? s.team.filter((_, j) => j !== i) : s.team })),
    })),
    obAddPerson: () => set((s) => ({ team: [...s.team, { name: "", role: "Marketing", areas: [] }] })),
    obVolume,
    obSummaryTitle,
    obSummaryBody: account
      ? `You want ${S.goalTitle || "to grow"}. With your budget, your ${S.hoursWk} h/wk${S.obStrengths.length ? `, and what you’re good at (${S.obStrengths.slice(0, 3).join(", ").toLowerCase()})` : ""}, that’s the way I’d grow you. I do the day-to-day work; you okay the things that matter.`
      : `You want ${S.goalTitle || "to grow"}. With your budget, your ${S.profile.time}, and what you’re good at (${S.obStrengths.slice(0, 3).join(", ").toLowerCase() || "writing"}), that’s the way I’d grow you. I do the day-to-day work; you okay the things that matter.`,
    obStrengthSummary: S.obStrengths.slice(0, 3).join(" · ") || (account ? "" : "Writing · Product"),
    obPaceChips: ["Sprint · 2 weeks", "Steady · 4 weeks", "Gentle · 8 weeks"].map((t) => {
      const on = S.obPace === t;
      return {
        t,
        border: on ? "oklch(0.78 0.13 220)" : "oklch(0.4 0.06 250)",
        bg: on ? "oklch(0.78 0.13 220)" : "transparent",
        color: on ? "oklch(0.22 0.05 262)" : "oklch(0.85 0.03 250)",
        pick: () => set({ obPace: t }),
      };
    }),
    obPaceLine: `${S.obPace.split(" · ")[1]} it is — I’ll only ever ask for a few minutes of your day, and I handle the rest.`,
    obThreadMsgs: S.obThread.map((m) => ({ text: m.text, fromUser: m.from === "u", fromJ: m.from === "j", typing: !!m.typing })),
    obDraft: S.obDraft,
    onObDraft: (e: Ev) => set({ obDraft: e.target.value }),
    obSend: obSendImpl,
    onObKey: (e: KEv) => {
      if (e.key === "Enter") obSendImpl();
    },
    isToday: S.onboarded && S.view === "today",
    isSystems: S.view === "systems",
    isConnectors: S.view === "connectors",
    /** Channels (accounts mode only — Sidebar hides the entry in demo): where Unc reaches the founder. docs/CHANNELS.md */
    isChannels: S.view === "channels",
    goChannels: nav("channels"),
    channelsBg: S.view === "channels" ? activeBg : "transparent",
    channelsDot: S.view === "channels" ? cyan : dim,
    goToday: nav("today"),
    goSystems: nav("systems"),
    goConnectors: nav("connectors"),
    goTalk: toggleChat,
    todayBg: S.view === "today" ? activeBg : "transparent",
    systemsBg: S.view === "systems" ? activeBg : "transparent",
    connectorsBg: S.view === "connectors" ? activeBg : "transparent",
    todayDot: S.view === "today" ? cyan : dim,
    systemsDot: S.view === "systems" ? cyan : dim,
    connectorsDot: S.view === "connectors" ? cyan : dim,
    toggleChat,
    chatOpen: S.chatOpen,
    chatIsAI: S.chatMode === "ai",
    chatIsHuman: S.chatMode === "human",
    chatTitle: S.chatMode === "ai" ? "Junction" : "Human support",
    chatSub: S.chatMode === "ai" ? "In your corner · knows your numbers" : "Real people who know your setup · reply within hours",
    chatPlaceholder: S.chatMode === "ai" ? "Ask for work, a change, an explanation…" : "Ask Sam anything — strategy, setup, a second opinion…",
    modeAI: () => set({ chatMode: "ai" }),
    modeHuman: () => set({ chatMode: "human" }),
    aiBg: S.chatMode === "ai" ? "oklch(0.78 0.13 220)" : "transparent",
    aiFg: S.chatMode === "ai" ? "oklch(0.22 0.05 262)" : "oklch(0.72 0.06 235)",
    huBg: S.chatMode === "human" ? "oklch(0.78 0.13 220)" : "transparent",
    huFg: S.chatMode === "human" ? "oklch(0.22 0.05 262)" : "oklch(0.72 0.06 235)",
    chatMsgs: (S.chatMode === "ai" ? S.messages : S.humanThread).map((m) => ({
      text: m.text,
      fromUser: m.from === "u",
      fromJunction: m.from !== "u",
      typing: !!m.typing,
      link: !!m.link,
      linkLabel: m.linkLabel,
      linkGo: () => {
        const s2 = ALL_SYSTEMS.find((x) => x.id === m.link);
        if (s2) openSys(s2);
      },
    })),
    connectors,
    connSummary,
    isStrategy: S.view === "strategy",
    goStrategy: nav("strategy"),
    strategyBg: S.view === "strategy" ? activeBg : "transparent",
    strategyDot: S.view === "strategy" ? cyan : dim,
    postures,
    phases,
    postureName: pd.label,
    postureWhy: `${pd.why} Right now that’s shaped by ${S.profile.budget} for paid, ${S.profile.time} of your time, and your strengths: ${(S.obStrengths.join(", ") || "writing, product").toLowerCase()}.`,
    simpleRead,
    scrollToNeeds: () => {
      const el = document.querySelector('[data-buddy^="Only you"]');
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
    },
    routineCount,
    libTotal: ALL_SYSTEMS.length,
    nextBest: nextBestSugg ? nextBestSugg.name : "Abandoned cart recovery",
    addNextBest: () => {
      if (nextBestSugg) nextBestSugg.add();
    },
    profBudget: S.profile.budget,
    onProfBudget: (e: Ev) => set((s) => ({ profile: { ...s.profile, budget: e.target.value } })),
    profTime: S.profile.time,
    onProfTime: (e: Ev) => set((s) => ({ profile: { ...s.profile, time: e.target.value } })),
    profStrength: S.profile.strength,
    onProfStrength: (e: Ev) => set((s) => ({ profile: { ...s.profile, strength: e.target.value } })),
    profBelief: S.profile.belief,
    onProfBelief: (e: Ev) => set((s) => ({ profile: { ...s.profile, belief: e.target.value } })),
    readThread: S.readThread.map((m) => ({ text: m.text, fromUser: m.from === "u", fromJ: m.from === "j" })),
    readDraft: S.readDraft,
    onReadDraft: (e: Ev) => set({ readDraft: e.target.value }),
    /* Accounts: no canned replies — the chips are demo furniture (the live Unc chat answers instead). */
    readChips: (account ? [] : ([
      ["Challenge this read", "Fair. The organic-first call rests on two numbers: CVR 3.1% and NZ$54/day headroom. If you think paid can beat 2.5× now, I’ll stage a NZ$20/day probe behind an approval and we’ll let the data argue."],
      ["Budget changed", "Tell me the new number and I’ll re-rank the paths tonight — more headroom pulls paid forward; less makes retention and CRO carry more."],
      ["I have more time this week", "Then I’ll queue the two moves that need your voice — welcome-flow copy and one founder post — and hold the rest. That’s the highest-leverage use of your hours."],
    ] as [string, string][])).map(([t, reply]) => ({
      t,
      send: () => set((s) => ({ readThread: [...s.readThread, { from: "u", text: t }, { from: "j", text: reply }] })),
    })),
    klaviyoDown,
    /* Accounts: the "Reconnected Klaviyo" bubble is demo furniture (a real reconnect lands as a connector read line). */
    klaviyoOk: account ? false : klaviyoState === "ok",
    fixKlaviyo: () => set((s) => ({ connState: { ...s.connState, Klaviyo: "ok" } })),
    readSend: readSendImpl,
    onReadKey: (e: KEv) => {
      if (e.key === "Enter") readSendImpl();
    },
    goalTitle: S.goalTitle,
    onGoalTitle: (e: Ev) => set({ goalTitle: e.target.value }),
    curSym,
    deadline: S.deadline,
    onDeadline: (e: Ev) => set({ deadline: e.target.value || S.deadline }),
    daysLeft: daysLeftN,
    daysLeftLabel: account && !S.deadline ? "no deadline yet" : `${daysLeftN} day${daysLeftN === 1 ? "" : "s"}`,
    /** Accounts: the goal line / deadline are empty until the founder sets them — Home says so instead of demo maths. */
    goalMissing: account && !S.goalTitle.trim(),
    deadlineMissing: account && !S.deadline,
    needsCount,
    allClear: needsCount === 0,
    nowFmt: fmt(cur),
    paceFmt: fmt(pace),
    neededFmt: fmt(needed),
    projFmt: fmt(proj),
    neededColor: needed > pace ? "oklch(0.5 0.12 75)" : "oklch(0.27 0.05 262)",
    statusLabel: onTrack ? "On track" : `Behind by ${fmt(gap)}`,
    statusColor: onTrack ? "oklch(0.45 0.1 240)" : "oklch(0.5 0.12 75)",
    statusBg: onTrack ? "oklch(0.94 0.03 225)" : "oklch(0.93 0.05 80)",
    /* Accounts: the read is the daily brief (TodayBrief) + KPI deltas — the demo's NZ$54/day / 14% / 22% story has no render path. */
    strategicRead: account
      ? ""
      : `At ${fmt(pace)}/day you land at ${fmt(proj)}${onTrack ? " — clear of the goal. Hold the line and bank the learning." : ` — ${fmt(gap)} short.`} I weighed 14 moves against your NZ$54/day budget headroom. Your site already converts ahead of industry and reels are compounding, so traffic isn’t the constraint — repeat purchase is (14% vs a 22% norm). Retention closes the gap organically, for free. Paid could buy it faster, but it burns headroom retention gives us for nothing — it’s queued for when repeat crosses 18%.`,
    signals: account ? [] : SIGNAL_DEFS,
    levers: account ? [] : LEVER_DEFS,
    focus: (account ? [] : ["D05-W03", "D05-W01", "D05-W04"]).map((id) => {
      const s = ALL_SYSTEMS.find((x) => x.id === id)!;
      return { name: s.name, open: () => openSys(s) };
    }),
    showBuddy: S.onboarded,
    buddyText: S.buddyText,
    hasBuddyText: !!S.buddyText && !S.chatOpen,
    /* Accounts: "Setting up next" = the plan's phase-1 wave-1 routines not yet on, with honest availability (src/lib/setup/home.ts). */
    proposals: account
      ? realProposals({ routineOn: S.routineOn, connState: S.connState, posture: S.posture, obStrengths: S.obStrengths, budgetMo: S.budgetMo }).map((p) => ({
          id: p.id as string,
          name: p.name,
          why: p.why,
          ready: p.ready,
          blocked: p.blocked,
          blockedLabel: p.blockedLabel,
          building: false,
          turnOn: () => {
            const s2 = ALL_SYSTEMS.find((x) => x.id === p.id);
            if (s2) set((s) => ({ routineOn: { ...s.routineOn, [s2.name]: true } }));
          },
        }))
      : [
          { id: "D05-W01", name: "Welcome flow tuning", why: "Your welcome flow converts 2.1%; tuned flows in your category do 6%+. Sequence drafted from your top customer questions." },
          { id: "D05-W06", name: "Review request timing", why: "Reviews lift repeat purchase ~9% in your category. Trigger drafted: 12 days post-delivery, suppressed for open tickets." },
          { id: "D06-W02", name: "PDP conversion review", why: "The free CRO path. A/B test staged on your top 3 products — copy from real support language." },
        ].map((p, i) => ({
          ...p,
          ready: S.propStatus[i] === "ready",
          blocked: S.propStatus[i] === "blocked",
          blockedLabel: undefined as string | undefined,
          building: S.propStatus[i] === "building",
          turnOn: () => set((s) => ({ propStatus: s.propStatus.map((x, j) => (j === i ? "building" : x)) })),
        })),
    goalPct: gm.goalPct,
    /** Accounts mode: the goal row's baseline is NULL, so pace/progress above are demo maths — Home says so instead (BASELINE_NOT_SET_COPY). */
    baselineMissing: S.baselineNum === null,
    approvals,
    /** Open a routine's detail by catalog id (live approval / draft rows → "Inspect the system →"). */
    openRoutineById: (id: string) => openSys(ALL_SYSTEMS.find((x) => x.id === id)),
    /** Jump to a routines category (DB-mode "The bar" fix buttons; the demo cards carry their own closures). */
    openCategory: (cat: string) => set({ view: "systems", selCat: cat, sel: null }),
    pendingCount: account ? realPending : S.apStatus.filter((x) => x === "pending").length,
    /* Accounts: live receipts (facts.receipts / useLiveApprovals) — the demo's R-448x rows have no render path. */
    completed: account ? (facts?.receipts ?? []).map((r) => ({ text: r.text, receipt: `${r.kind} · receipt ${r.id.slice(0, 8)}` })) : COMPLETED_DEFS,
    catChips,
    visibleSystems,
    noSel: !sel,
    hasSel: !!sel,
    catAll: S.selCat === "All",
    catOne: S.selCat !== "All",
    catCards: CATEGORIES.map((c) => {
      const onN = c.systems.filter((n) => isOn(n)).length;
      return {
        name: c.name,
        tagline: CAT_TAGLINES[c.name] || "",
        onLabel: `${onN} of ${c.systems.length} on`,
        open: () => set({ selCat: c.name }),
      };
    }),
    backToCats: () => set({ selCat: "All" }),
    selCatName: S.selCat,
    selCatTag: CAT_TAGLINES[S.selCat] || "",
    channelRows: (S.selCat === "All" ? [] : ALL_SYSTEMS.filter((s2) => s2.cat === S.selCat)).map((s2) => {
      const on = isOn(s2.name);
      return {
        benefit: s2.benefit,
        name: s2.name,
        /* Accounts: hours saved are measured from real runs (telemetry), never the id-hash "saves ~N h/wk". */
        saves: account ? 0 : 2 + (s2.id.charCodeAt(5) % 3),
        togBg: on ? "oklch(0.72 0.17 150)" : "oklch(0.88 0.015 260)",
        knobLeft: on ? "19.5px" : "2.5px",
        toggle: () => set((st) => ({ routineOn: { ...st.routineOn, [s2.name]: !on } })),
        how: () => openSys(s2),
      };
    }),
    selId: sel?.id,
    selCat: sel?.cat,
    selName: sel?.name,
    selPurpose: sel?.purpose,
    selCadence: sel?.cadence,
    selMode: sel?.mode,
    selKpi: sel?.kpi,
    selState: sel ? stateLabel(sel) : undefined,
    selStateColor: selState[0],
    selStateBg: selState[1],
    selSteps,
    closeSys: () => set({ sel: null }),
    messages: msgs,
    draft: S.draft,
    send,
    onDraft: (e: Ev) => set({ draft: e.target.value }),
    onKey: (e: KEv) => {
      if (e.key === "Enter") send();
    },

    /* ---- guided first run + real-only Home (accounts mode; docs/PRODUCT-EXPERIENCE.md) ---- */
    setupFlow: S.setupFlow,
    setSetupFlow: (flow: PlatformState["setupFlow"]) => set({ setupFlow: flow, ...(flow === "home" ? { view: "today" as const } : {}) }),
    setupConnectLater: S.setupConnectLater,
    /** "I'll do this later" on the Connect step — an honest state, never a fake connection. */
    markConnectLater: () => set({ setupConnectLater: true, setupFlow: "routine" }),
    setupCardDismissed: S.setupCardDismissed,
    dismissSetupCard: () => set({ setupCardDismissed: true }),
    planAgreedAt: S.planAgreedAt,
    savedPlan: facts?.plan ?? null,
    automationPaused: account && S.automationPaused === true,
    setPlanAgreedAt: (iso: string | null) => set((s) => (s.planAgreedAt === iso ? {} : { planAgreedAt: iso })),
    settlePlan: S.settlePlan,
    clearSettlePlan: () => set((s) => (s.settlePlan ? { settlePlan: false } : {})),
    firstRunPending: S.firstRunPending,
    setFirstRunPending: (v: boolean) => set((s) => (s.firstRunPending === v ? {} : { firstRunPending: v })),
    /** Flip a routine on locally by catalog id (the autosave persists routine_states.enabled). */
    enableRoutineLocal: (id: string) => {
      const s2 = ALL_SYSTEMS.find((x) => x.id === id);
      if (s2) set((s) => ({ routineOn: { ...s.routineOn, [s2.name]: true } }));
    },
    /** Real connector state only (never the demo `|| "expired"` default): Klaviyo really needs a reconnect. */
    klaviyoNeedsReconnect: account ? klaviyoState === "expired" : S.connState["Klaviyo"] === "expired",
    /** Which world this view model describes — see DeriveOptions. */
    accountMode: account,
    /** Open the guided Connect-your-data step's platform in the Connectors view. */
    goConnectorsView: nav("connectors"),
    /** Routine ids that are really on (routine_states.enabled projection) — never the catalog's demo "Active" defaults. */
    enabledRoutineIds: ALL_SYSTEMS.filter((x) => (account ? isOn(x.name) : S.routineOn[x.name] === true)).map((x) => x.id),
    routineOnById: (id: string) => {
      const s2 = ALL_SYSTEMS.find((x) => x.id === id);
      return !!s2 && (account ? isOn(s2.name) : S.routineOn[s2.name] === true);
    },
    /** Real connector state by card name ("off" when no row exists — never the demo defaults). */
    connStateByName: (name: string): ConnStatus => (account ? connOf(name, "off") : (S.connState[name] ?? "off")),
    /** The founder's own answers, for the real Home / guided steps (never demo constants). */
    accountCtx: { currency: S.currency, budgetMonthly: S.budgetMo },
    /** The persisted rows the real Home view model (src/lib/setup/home.ts) reads. */
    realInputs: { routineOn: S.routineOn, connState: S.connState, posture: S.posture, obStrengths: S.obStrengths, budgetMo: S.budgetMo, scan: S.scan, obPlatforms: S.obPlatforms },
    routineNameById: (id: string) => ALL_SYSTEMS.find((x) => x.id === id)?.name ?? id,
  };
}

export type PlatformVals = ReturnType<typeof derive>;
// Referenced for API completeness with the prototype's exported logic surface.
export { POSTURE_WEIGHTS };
