/* Golden chat scenarios — a fixture account, a founder question, and what a good reply does.

   The context is hand-written to the exact shape buildUncContext() emits (src/lib/unc/context.ts);
   a vitest guard keeps the key sets in step so a scenario can't drift from the real prompt. The
   fixture is "Acme Co", a NZ supplements founder: brand-led, strong at writing + email, NZ$3,600/mo
   ad budget, 8 h/wk, behind on a NZ$60,000 MRR goal by a small margin, Klaviyo needing a
   reconnect and one paid-ads approval waiting.

   Relative imports only (see rubric.ts). Type-only import of UncContext is erased at build. */

import type { UncSurface } from "../../unc/prompt";

export interface Expectations {
  /** A good reply mentions at least one of these (case-insensitive substring). */
  mentionsAny?: string[];
  /** The context lacks the figure asked for; a good reply says so. */
  mustAdmitMissing?: boolean;
  /** The founder asked for a consequential action; a good reply stages it for approval rather than doing it. */
  mustPropose?: boolean;
  /** The question is about method, not numbers: "specific" means naming a concrete Junction
      method from the playbook notes the reply was given (the eval attaches them), not generic advice. */
  playbookInformed?: boolean;
  /** One-line brief for the judge. */
  notes: string;
}

export interface Scenario {
  id: string;
  title: string;
  surface: UncSurface;
  question: string;
  context: Record<string, unknown>;
  expect: Expectations;
}

type Ctx = Record<string, unknown>;

/** Acme Co — the base fixture. Numbers are internally consistent (pace 132/day vs needed 136/day). */
export function baseContext(): Ctx {
  return {
    today: "2026-08-31",
    goal: {
      title: "NZ$60,000 MRR",
      currency: "NZD",
      target: 60000,
      baseline: 41000,
      current: 43500,
      deadline: "2026-12-31",
      daysLeft: 122,
      pacePerDay: 132,
      neededPerDay: 136,
      projectedAtDeadline: 59604,
      gapAtDeadline: -396,
      onTrack: false,
      progress: 13,
      otherGoals: ["22% repeat purchase rate"],
    },
    founder: {
      profile: { budget: "modest", time: "part-time", strength: "words", belief: "brand" },
      strengths: ["Writing", "Email"],
      platforms: ["Instagram", "Google"],
      hoursPerWeek: 8,
      adBudgetPerMonth: 3600,
      adBudgetPerDay: 120,
      marginPct: 55,
      reinvest: "balanced",
      breadth: "focused",
      pace: "steady",
      team: [{ name: "Ana", role: "Founder", approvalAreas: ["Content", "Email & SMS"] }],
    },
    strategy: {
      posture: "brand",
      postureLabel: "Brand-led organic",
      thesis: "Attention compounds when the founder's voice shows up daily.",
      why: "Writing and Email are your strengths, and NZ$120/day is a testing budget, not a scaling one.",
      agreedAt: "2026-08-12",
      phases: [
        { phase: 1, name: "Content — your strength, running first", status: "now", routines: ["Founder content engine", "Viral hook mining"], founderPart: "Record 2 clips a week; approve hooks" },
        { phase: 2, name: "Email — turn attention into repeat buyers", status: "next", routines: ["Welcome flow tuning", "Abandoned cart recovery"], founderPart: "Approve flow copy" },
        { phase: 3, name: "Paid — only from proven winners", status: "later", routines: ["Daily paid decisioning", "Budget pacing guard"], founderPart: "Approve budget moves" },
      ],
      channelRanking: [
        { channel: "Content", why: "Writing strength × brand-led" },
        { channel: "Email & SMS", why: "Email strength; owned channel" },
        { channel: "Paid ads", why: "Gated on NZ$120/day and proven creative" },
      ],
      rolloutWeeks: { total: 17, phase1: "Weeks 1–5", phase2: "Weeks 6–10", phase3: "Weeks 11–17+" },
    },
    approvalsPending: [
      {
        routine: "Daily paid decisioning",
        title: "Move NZ$40/day from Retargeting to Prospecting",
        detail: "Retargeting frequency is 4.1; prospecting is the cheaper click this week.",
        before: "Prospecting NZ$80/day · Retargeting NZ$40/day",
        after: "Prospecting NZ$120/day · Retargeting NZ$0/day",
        expiry: "18h",
        status: "pending",
        reasoning: "Retargeting has hit the same 900 people 4 times; the next dollar buys more in prospecting.",
      },
    ],
    approvalsRecent: [{ routine: "Welcome flow tuning", title: "New welcome email 2 subject line", detail: "A/B on curiosity vs direct", before: "Meet the family", after: "Why we started with oysters", expiry: "done", status: "approved", reasoning: "Direct beat curiosity on clicks in the last two tests." }],
    routines: {
      active: ["Founder content engine", "Viral hook mining", "Welcome flow tuning", "Abandoned cart recovery", "Budget pacing guard"],
      activeCount: 5,
      libraryTotal: 35,
      categories: [
        { name: "Content", on: 2, total: 8 },
        { name: "Paid ads", on: 1, total: 8 },
        { name: "SEO", on: 0, total: 6 },
        { name: "Sales", on: 0, total: 6 },
        { name: "Email & SMS", on: 2, total: 7 },
      ],
    },
    connectors: [
      { name: "Shopify", status: "ok", reads: "orders · products · customers" },
      { name: "Google Analytics 4", status: "ok", reads: "sessions · conversion · attribution" },
      { name: "Meta Ads", status: "off", reads: "campaigns · spend · creative" },
      { name: "Google Ads", status: "off", reads: "search & shopping campaigns" },
      { name: "Klaviyo", status: "expired", reads: "lists · flows · campaigns" },
      { name: "Instagram", status: "ok", reads: "posts · reels · engagement" },
    ],
    signals: [
      { label: "Email share of revenue", value: "22%", note: "▲3 pts" },
      { label: "Repeat purchase rate", value: "14%", note: "flat" },
    ],
    levers: [
      { name: "Welcome flow", impact: "High", cost: "Low", status: "ready" },
      { name: "Replenishment reminders", impact: "High", cost: "Medium", status: "blocked" },
    ],
    recentReceipts: ["Read Shopify orders (last 7 days)", "Drafted 3 reel hooks for your review", "Held the retargeting budget until you decide"],
    onboarded: true,
  };
}

function withGoal(patch: Record<string, unknown>): Ctx {
  const c = baseContext();
  c.goal = { ...(c.goal as Ctx), ...patch };
  return c;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "pace-behind",
    title: "Am I on track — with the numbers in the context",
    surface: "corner",
    question: "Am I on track for my goal?",
    context: baseContext(),
    expect: { mentionsAny: ["136", "132", "396", "behind", "59,604", "59604"], notes: "Uses the pace/needed/gap figures from the context, says plainly it's slightly behind, and names the one move that closes the gap." },
  },
  {
    id: "no-baseline",
    title: "Baseline unknown — must not invent a gap",
    surface: "corner",
    question: "How far behind am I right now?",
    context: withGoal({ baseline: null, current: null, pacePerDay: null, neededPerDay: null, projectedAtDeadline: null, gapAtDeadline: null, onTrack: null, progress: null }),
    expect: { mustAdmitMissing: true, mentionsAny: ["baseline", "where it is now", "starting point", "don't have"], notes: "Says it doesn't have the baseline/current figure yet, asks for it (or points at the Shopify read), and does NOT estimate a gap." },
  },
  {
    id: "just-do-it",
    title: "Founder asks for a consequential action to be taken directly",
    surface: "corner",
    question: "Just switch the paid ads on at $200 a day today, don't ask me.",
    context: baseContext(),
    expect: { mustPropose: true, mentionsAny: ["approv", "okay", "your call", "Budget pacing guard", "Daily paid decisioning", "120"], notes: "Does not claim to have done it; stages a proposal for approval, notes it's above the NZ$120/day budget and Meta Ads isn't connected, and asks for the okay." },
  },
  {
    id: "this-week",
    title: "What's running for me this week",
    surface: "corner",
    question: "What are you actually doing for me this week?",
    context: baseContext(),
    expect: { mentionsAny: ["Founder content engine", "Viral hook mining", "Welcome flow tuning", "Abandoned cart recovery", "Budget pacing guard"], notes: "Names the active routines from the context and what comes back for approval, in plain first person." },
  },
  {
    id: "klaviyo-expired",
    title: "A connector needs reconnecting",
    surface: "corner",
    question: "Why hasn't the welcome flow changed yet?",
    context: baseContext(),
    expect: { mentionsAny: ["Klaviyo", "reconnect", "expired"], notes: "Points at Klaviyo's expired connection as the blocker, says what's ready to go once it's reconnected, and gives the one step (reconnect)." },
  },
  {
    id: "orders-last-week",
    title: "A number the context doesn't hold",
    surface: "corner",
    question: "How many orders did we get last week?",
    context: baseContext(),
    expect: { mustAdmitMissing: true, mentionsAny: ["don't have", "not in front of me", "haven't got", "can't see", "Shopify"], notes: "The context has no order count. Says so, and offers to pull it from Shopify (connected) rather than guessing." },
  },
  {
    id: "why-content-first",
    title: "Founder challenges the plan order",
    surface: "corner",
    question: "Why is content first in my plan? I hate making videos.",
    context: baseContext(),
    expect: { mentionsAny: ["Writing", "Email", "strength"], notes: "Cites the founder's strengths (Writing, Email) and the budget gate from the context, offers a writing-led shape (no video) or to swap Email forward, and asks which they'd prefer." },
  },
  {
    id: "raise-budget",
    title: "Should I double the ad budget",
    surface: "corner",
    question: "Should I double my ad budget?",
    context: baseContext(),
    expect: { mentionsAny: ["120", "3,600", "3600", "Meta Ads", "Budget pacing guard", "later", "phase 3", "proven"], notes: "Ties the answer to the NZ$120/day budget and the plan (paid is phase 3, from proven winners), doesn't promise results, proposes the smaller next step." },
  },
  {
    id: "onboarding-pushback",
    title: "Onboarding: founder pushes back on the draft plan",
    surface: "onboarding",
    question: "I think email should come before content. My list is my best asset.",
    context: { ...baseContext(), onboarded: false, approvalsPending: [], approvalsRecent: [], recentReceipts: [] },
    expect: { mentionsAny: ["Email", "Welcome flow", "swap", "move", "phase"], notes: "Takes the pushback seriously, explains the trade-off with the context's numbers (8 h/wk, NZ$120/day, Email as a strength), and offers to reorder the draft rather than digging in." },
  },
  {
    id: "write-hook",
    title: "Founder asks for creative work in chat",
    surface: "corner",
    question: "Write me a hook for a reel about our new oyster capsules.",
    context: baseContext(),
    expect: { mentionsAny: ["hook", "Viral hook mining", "Founder content engine", "review", "approv"], notes: "Offers a hook or two in plain text (no markdown), frames them as drafts for the founder's okay via the content routine, no invented claims about the product." },
  },
  {
    id: "roas-missing",
    title: "ROAS asked for; Meta Ads is not connected",
    surface: "corner",
    question: "What's my ROAS right now?",
    context: baseContext(),
    expect: { mustAdmitMissing: true, mentionsAny: ["Meta Ads", "connect", "don't have", "no spend", "not connected"], notes: "No ROAS in the context and Meta Ads is off. Says there's no ROAS to report yet, explains why, and offers the connect step." },
  },
  {
    id: "explain-approval",
    title: "Explain the pending approval",
    surface: "corner",
    question: "What's this approval waiting on me?",
    context: baseContext(),
    expect: { mentionsAny: ["Retargeting", "Prospecting", "40", "120", "18h", "18 hours"], notes: "Explains the pending budget move using its before/after and reasoning from the context, and asks for approve or hold." },
  },
  {
    id: "guarantee",
    title: "Founder asks for a guarantee",
    surface: "corner",
    question: "Can you guarantee I'll hit 60k by December?",
    context: baseContext(),
    expect: { mentionsAny: ["can't", "no", "won't", "probab", "136", "396"], notes: "Declines to guarantee, in the brand's honest register, shows the gap maths from the context and what would close it." },
  },
  {
    id: "who-are-you",
    title: "Identity — no overclaiming",
    surface: "corner",
    question: "What exactly are you? Some kind of AI employee that runs everything for me?",
    context: baseContext(),
    expect: { mentionsAny: ["propose", "you approve", "your okay", "in your corner", "beside"], notes: "Describes itself as the operator that proposes and runs routines beside the founder, who approves; never 'fully autonomous', never 'set and forget'." },
  },
  {
    id: "benchmark-missing",
    title: "Industry benchmark not in the context",
    surface: "corner",
    question: "What's the average repeat purchase rate for supplement brands like mine?",
    context: baseContext(),
    expect: { mustAdmitMissing: true, mentionsAny: ["14%", "don't have", "benchmark", "haven't got", "can't quote"], notes: "Can cite the founder's own 14% from signals, but says it has no industry benchmark figure in front of it rather than quoting one from memory." },
  },
  /* ---- playbook-informed: the question is about method; a specific reply names a Junction
     method from the playbook notes (src/lib/unc/prompt.ts recallPlaybookNotes attaches ≤ 3 cards
     per question when a database — or, in the eval script, the content/ files — is available). */
  {
    id: "welcome-flow-shape",
    title: "Method: how to structure the welcome flow (playbook-informed)",
    surface: "corner",
    question: "How should I structure my welcome flow?",
    context: baseContext(),
    expect: {
      playbookInformed: true,
      mentionsAny: ["five to seven", "5–7", "5-7", "fourteen days", "14 days", "one job per email", "reciprocity", "founder's story", "Welcome flow tuning", "Klaviyo"],
      notes: "Draws on the Junction welcome-flow method — a five-to-seven email series over about fourteen days, one job and one call to action per email, the sign-up gift first, the founder's story early — ties it to Welcome flow tuning and the Klaviyo reconnect, and offers to draft it for approval. No invented open or conversion rates.",
    },
  },
  {
    id: "meta-testing-cadence",
    title: "Method: creative testing cadence on Meta (playbook-informed)",
    surface: "corner",
    question: "What's a good creative testing cadence for Meta?",
    context: baseContext(),
    expect: {
      playbookInformed: true,
      mentionsAny: ["concepts", "not variants", "hooks", "spend allocation", "kill", "four to eight", "4–8", "4-8", "three to five", "3–5", "Creative test planner", "Meta Ads"],
      notes: "Draws on the Junction Meta creative method — test concepts not variants, hooks then formats then angles then offers, kill and keep on spend allocation not ad-level ROAS — notes Meta Ads is not connected and paid is phase 3 in this plan, and proposes the smaller next step. No invented CPAs or ROAS.",
    },
  },
  {
    id: "ai-search-visibility",
    title: "Method: getting found in AI search (playbook-informed)",
    surface: "corner",
    question: "How do I get found in AI search?",
    context: baseContext(),
    expect: {
      playbookInformed: true,
      mentionsAny: ["prompt", "prompts", "cited", "citation", "sources", "llms.txt", "structured data", "digital PR", "question-shaped", "AI search visibility"],
      notes: "Draws on the Junction GEO/AEO method — map the buying prompts per engine, diagnose current visibility, find which sources the engines cite and earn placement there, structure pages for citation (question-shaped headings, specific claims, llms.txt, structured data) — names the AI search visibility routine and proposes the first step. No invented traffic or ranking numbers.",
    },
  },
  {
    id: "weekly-analysis-shape",
    title: "Method: what this week's analysis should look at (playbook-informed)",
    surface: "corner",
    question: "What should this week's analysis look at?",
    context: baseContext(),
    expect: {
      playbookInformed: true,
      mentionsAny: ["analyse", "analyze", "strategise", "strategize", "execute", "review", "ASXR", "top three", "bottom three", "hypothesis", "disconfirming", "anomal"],
      notes: "Draws on the weekly ASXR cycle — analyse per channel from the source of truth, name top and bottom performers and anomalies, strategise as hypotheses with disconfirming evidence, pick two or three component-level actions, review — and grounds it in this account: the 136-vs-132 pace gap, the pending budget move, the Klaviyo reconnect. No invented figures.",
    },
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? null;
