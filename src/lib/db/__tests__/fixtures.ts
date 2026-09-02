/* A PlatformState with every persisted field set to a NON-default value, so a round-trip
   that silently fell back to initialState would fail. Keep in sync with mapping.ts. */

import { initialState, type PlatformState } from "@/lib/platform/state";

export const PERSISTED_KEYS = [
  "currency",
  "goalTitle",
  "deadline",
  "obCats",
  "goalTexts",
  "baselineNum",
  "baselineText",
  "targetNum",
  "budgetMo",
  "hoursWk",
  "reinvest",
  "marginPct",
  "website",
  "socials",
  "obStrengths",
  "obPlatforms",
  "obPostureSet",
  "posture",
  "obBreadth",
  "team",
  "routineOn",
  "connState",
  "messages",
  "humanThread",
  "obThread",
  "routineEdits",
  "narrative",
  "scan",
  "wfState",
  "wfVer",
  "onboarded",
  "obStep",
  "obPace",
  "profile",
] as const satisfies readonly (keyof PlatformState)[];

export type PersistedKey = (typeof PERSISTED_KEYS)[number];

export function richState(): PlatformState {
  return {
    ...initialState,
    // transient UI — must NOT round-trip
    view: "systems",
    selCat: "SEO",
    chatOpen: true,
    apWhy: [true, false, true],
    // persisted
    currency: "AUD",
    goalTitle: "A$90,000 MRR",
    deadline: "2026-12-31",
    obCats: ["revenue", "brand", "leads"],
    goalTexts: { ...initialState.goalTexts, revenue: "A$90,000 MRR", brand: "40k engaged followers", leads: "80 qualified leads/mo", profit: "70% blended margin" },
    baselineNum: 41000,
    baselineText: "A$41,000 MRR today",
    targetNum: 90000,
    budgetMo: 5200,
    hoursWk: 12,
    reinvest: "aggressive",
    marginPct: 55,
    website: "https://example.com",
    socials: "@example\nhttps://tiktok.com/@example",
    obStrengths: ["Video", "Paid media", "SEO"],
    obPlatforms: ["TikTok", "LinkedIn", "Google (Search & Ads)"],
    obPostureSet: ["paid", "brand"],
    posture: "paid",
    obBreadth: "broad",
    team: [
      { name: "Ana", role: "Founder", areas: ["Content", "Sales"] },
      { name: "Ben", role: "Marketing", areas: [] },
      { name: "", role: "Marketing", areas: ["Email & SMS"] },
    ],
    routineOn: { "Founder content engine": true, "Daily paid decisioning": false, "Welcome flow tuning": true },
    connState: { Klaviyo: "ok", Shopify: "off", "Meta Ads": "expired" },
    apStatus: ["approved", "held", "pending"],
    messages: [
      { from: "j", text: "Morning Ana. One decision is waiting.", link: "D02-W01", linkLabel: "Inspect the system →" },
      { from: "u", text: "Why?" },
      { from: "j", text: "Because ROAS." },
    ],
    humanThread: [
      { from: "h", text: "Kia ora — Sam here." },
      { from: "u", text: "Hi Sam." },
    ],
    obThread: [
      { from: "u", text: "What will you do first?" },
      { from: "j", text: "Content, then retention." },
      { from: "j", text: "", typing: true }, // dropped on save
    ],
    routineEdits: { "paid.0": ["Daily paid decisioning", "Ad fatigue watch"], "brand.1": ["Welcome flow tuning"] },
    narrative: {
      status: "done",
      key: "nk",
      baseKey: "nb",
      value: { title: "Paid first, brand behind it", mathLine: "A$49,000 to find in 17 weeks.", phaseNotes: ["Buy learning fast.", "Then retention.", "Then scale."], footnote: "Numbers are yours." },
    },
    scan: {
      status: "done",
      key: "sk",
      profile: {
        name: "Example Co",
        oneLiner: "Sells examples",
        category: "DTC",
        products: ["Widget"],
        audience: "Founders",
        voice: { tone: "warm", phrases: ["kia ora"] },
        market: { region: "AU", competitorsMentioned: [] },
        signals: ["fast shipping"],
        confidence: "medium",
        sources: ["https://example.com"],
      },
    },
    wfState: "draft",
    wfVer: 14,
    onboarded: true,
    obStep: 6,
    obPace: "Sprint · 2 weeks",
    profile: { budget: "≤ A$173/day", time: "12 h/wk", strength: "Video & Paid media & SEO", belief: "Buy learning fast + Brand before sales", team: "3 people" },
  };
}

/** The state as it should come back: identical except transient placeholders are gone. */
export function expectedAfterRoundTrip(S: PlatformState): PlatformState {
  return { ...S, obThread: S.obThread.filter((m) => !m.typing), messages: S.messages.filter((m) => !m.typing), humanThread: S.humanThread.filter((m) => !m.typing) };
}

export function pick(S: PlatformState, keys: readonly PersistedKey[] = PERSISTED_KEYS): Partial<PlatformState> {
  return Object.fromEntries(keys.map((k) => [k, S[k]]));
}
