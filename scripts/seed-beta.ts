/* scripts/seed-beta.ts — the six beta founders' accounts, seeded from what Junction already
   knows about each business (Decision 11, 2026-09-02). See docs/BETA.md for the per-founder
   known/unknown ledger, the invite flow and the email drafts.

   What it writes, per founder (through the SAME mapping the app uses — src/lib/db/mapping.ts
   stateToRows → src/lib/db/accountState.ts saveAccountRows — so the rows are exactly what a
   founder's own onboarding would have produced):

     accounts              one row, keyed by exact `name` (the idempotency key: 0001–0003 have
                           no metadata/slug column, so the name IS the beta_slug's home)
     goals                 one governing row (category + title + deadline); baseline only when
                           it was FOUND in the client docs — an unknown baseline is NULL, never 0
     resource_profiles     website, socials, strengths, known channels, postures, breadth;
                           budget/hours 0 when unknown (the column is not null); margin NULL
     business_profiles     a BusinessProfile-shaped record of the facts (scan_status stays
                           'pending' — no scan ran; `beta` carries the source notes)
     team_members          the founder (+ named team when the docs name them)
     connectors            status 'disconnected' for the platforms we know they use, so the
                           Connectors card can lead with them
     chat_messages         one honest Unc opener + one human-lane line from Tom (no demo chat)
     plans,                what stateToRows always writes (the three demo approval cards are
     account_state_meta    NOT persisted — demo furniture, never a founder's decisions)

   Membership is NOT seeded: account_members needs an auth.users row, and the founder has not
   signed up yet. The email → account attach happens at first login (docs/BETA.md §Invite flow;
   proposed migration scripts/beta/0009_beta_invites.sql).

   Run (no tsx in node_modules — same tsc pattern as the worker):
     npx tsc -p scripts/beta/tsconfig.json && node dist/beta/scripts/seed-beta.js --dry-run
     npx tsc -p scripts/beta/tsconfig.json && node dist/beta/scripts/seed-beta.js
     npx tsc -p scripts/beta/tsconfig.json && node dist/beta/scripts/seed-beta.js --sql > scripts/beta/seed-beta.sql
   (with tsx installed: npx tsx scripts/seed-beta.ts --dry-run)
   Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (process.env only — the app never
   reads .env files; `set -a; source .env.local; set +a` first). --only <slug,slug> limits the run.
   --sql needs no env: it prints idempotent SQL (betaSql) for the same rows, to apply through the
   Supabase Management SQL endpoint; --now <iso> pins the timestamps (deterministic output). */

import { saveAccountRows } from "../src/lib/db/accountState";
import { CONNECTOR_PLATFORMS, stateToRows, type AccountRows } from "../src/lib/db/mapping";
import { unwrap, type DbClient } from "../src/lib/db/types";
import type { Posture } from "../src/lib/platform/plan";
import { initialState, type ConnStatus, type PlatformState } from "../src/lib/platform/state";
import type { BusinessProfile } from "../src/lib/unc/scan";

// ---------- types ----------

/** Connector slugs a founder is known to use (connectors.platform). */
export type BetaPlatform = "shopify" | "klaviyo" | "meta_ads" | "google_ads" | "ga4";
/** goals.category values the product knows (initialState.goalTexts keys). */
export type GoalCategory = "revenue" | "profit" | "brand" | "leads" | "retention" | "launch";
export type Currency = "NZD" | "AUD" | "USD";

export interface BetaGoal {
  category: GoalCategory;
  /** The governing goal line in the product's format — target parsed from the first number. */
  title: string;
  target: number;
  /** ISO date. */
  deadline: string;
  /** Where the line came from: the client's own docs, or a Junction proposal to confirm on the call. */
  source: "client-docs" | "proposed";
}

export interface BetaBaseline {
  value: number;
  /** ISO date the reading was taken. */
  asOf: string;
  /** Where the number was found — never a guess. */
  source: string;
}

export interface BetaAccount {
  /** Stable handle used in docs/BETA.md, --only, and the invite table. Not a column. */
  slug: string;
  /** Exact accounts.name — the idempotency key. Do not rename without a data migration. */
  name: string;
  /** Founder's name as known; null when the docs don't name them (team row reads "You"). */
  founder: string | null;
  website: string | null;
  /** Handles / URLs as found. Never guessed. */
  socials: string[];
  /** Business category (free text → business_profiles.profile.category). */
  category: string;
  currency: Currency;
  goal: BetaGoal;
  /** null = unknown. The seed writes NULL, never 0, for an unknown baseline. */
  baseline: BetaBaseline | null;
  /** Connector platforms they are known to use → connectors rows (status 'disconnected'). */
  platforms: BetaPlatform[];
  /** obStrengthChips values (derive.ts). */
  strengths: string[];
  /** obPlatformChips values (derive.ts) → resource_profiles.known_platforms. */
  channels: string[];
  posture: Posture;
  postureSet: Posture[];
  breadth: "focused" | "broad";
  /** null = unknown → resource_profiles.budget_monthly 0 (not null column) — flagged in notes. */
  budgetMonthly: number | null;
  hoursWeekly: number | null;
  /** null = unknown → resource_profiles.gross_margin_pct NULL (never the demo 30). */
  grossMarginPct: number | null;
  /** Named team beyond the founder, when the docs name them. */
  team: { name: string; role: string }[];
  /** BusinessProfile fields worth seeding (region, audience, one-liner). */
  profile: { oneLiner: string; audience: string | null; region: string; products: string[] };
  /** What is known / unknown / assumed — surfaces in business_profiles.profile.beta.notes. */
  notes: string[];
}

// ---------- the six ----------

const SIX_MONTHS_OUT = "2027-03-01";

export const BETA_ACCOUNTS: BetaAccount[] = [
  {
    slug: "unity-mma",
    name: "Unity MMA",
    founder: null,
    website: null,
    socials: ["instagram.com/unitymma_"],
    category: "MMA gym — memberships (Auckland)",
    currency: "NZD",
    goal: { category: "leads", title: "30 new membership sign-ups/mo", target: 30, deadline: SIX_MONTHS_OUT, source: "proposed" },
    baseline: null,
    platforms: [],
    strengths: ["Video", "Community"],
    channels: ["Instagram", "TikTok"],
    posture: "brand",
    postureSet: ["brand"],
    breadth: "focused",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [],
    profile: {
      oneLiner: "Auckland MMA gym with credible coaches, an active member culture and technique content that already travels (one tutorial reached 45.8K views).",
      audience: "Combat-sports followers worldwide for reach; Auckland locals for memberships",
      region: "NZ",
      products: ["Memberships", "Fundamentals classes", "School programmes"],
    },
    notes: [
      "Source: projects/unity-mma-content-audit (Content & Growth Playbook, Aug 2026).",
      "Known: Instagram @unitymma_; TikTok in scope (handle not recorded); coaches Brooke, Rory, Matt, Josh.",
      "Unknown: owner's name, website, membership numbers, current follower counts, ad spend, gym-management platform.",
      "Goal line is a Junction proposal — confirm the number on the invite call. Baseline unknown (NULL).",
      "No commerce/email/ads platform confirmed, so no connectors seeded.",
    ],
  },
  {
    slug: "dbh",
    name: "Deep Blue Health",
    founder: null,
    website: "https://deepbluehealth.co.nz",
    socials: [],
    category: "DTC supplements (NZ marine & natural health)",
    currency: "NZD",
    goal: { category: "retention", title: "25% repeat purchase rate", target: 25, deadline: SIX_MONTHS_OUT, source: "proposed" },
    baseline: null,
    platforms: ["shopify", "klaviyo", "meta_ads", "google_ads", "ga4"],
    strengths: ["Product", "Email"],
    channels: ["Instagram", "Facebook", "Google (Search & Ads)", "Email / SMS"],
    posture: "brand",
    postureSet: ["brand", "paid"],
    breadth: "broad",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [],
    profile: {
      oneLiner: "New Zealand natural-health supplements (Green Lipped Mussel, colostrum, deer velvet, marine collagen and more) sold direct on Shopify.",
      audience: "Health-conscious buyers in NZ and export markets",
      region: "NZ",
      products: ["Green Lipped Mussel", "Colostrum", "Deer Velvet", "Marine Collagen", "Propolis"],
    },
    notes: [
      "Source: clients/REGISTRY.md (DTC supplements, Managed Marketing); Junction's own DBH work history (Shopify PDP engine, Klaviyo flows, Meta + Google Ads weeks).",
      "Known: Shopify store; Klaviyo (two 'Placed Order' metrics — the API one reads $0, use the warehouse); Meta Ads and Google Ads accounts in use.",
      "Assumed: GA4 property exists (Google Ads in use) — confirm before it is offered as a connector.",
      "Unknown this session: founder's name (the client CLAUDE.md lives in ~/dbh-aios, unreadable on Drive today), Instagram handle (account dormant), revenue, repeat rate, ad budget.",
      "Goal line is a Junction proposal (retention is DBH's case-study focus) — confirm the number. Baseline unknown (NULL).",
    ],
  },
  {
    slug: "avgar",
    name: "AVGAR Sport",
    founder: "Heather Anderson",
    website: "https://avgarsport.com",
    socials: [],
    category: "Luxury women's golf apparel & accessories (DTC)",
    currency: "NZD",
    goal: { category: "revenue", title: "NZ$100,000 monthly revenue", target: 100000, deadline: "2027-01-15", source: "client-docs" },
    baseline: { value: 35000, asOf: "2026-07-12", source: "Junction CLAUDE.md goal tracker — AVGAR 28-day revenue ~NZ$35K (▲69.7%) on 2026-07-12; target NZ$100–150K by 15 Jan 2027" },
    platforms: ["shopify", "klaviyo", "meta_ads", "google_ads", "ga4"],
    strengths: ["Product", "Design", "Paid media"],
    channels: ["Instagram", "Facebook", "TikTok", "Google (Search & Ads)", "Email / SMS"],
    posture: "brand",
    postureSet: ["brand", "paid"],
    breadth: "broad",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [{ name: "Gwyn", role: "Product" }],
    profile: {
      oneLiner: "Luxury women's golf brand (patent + FernMark + Certilogo behind the luxury claim), sold direct on Shopify.",
      audience: "Affluent women golfers — NZ proof base, Australia growth market",
      region: "NZ / AU",
      products: ["Golf apparel", "Golf bags", "Accessories"],
    },
    notes: [
      "Source: clients/avgar-sport/CHANNELS.md (8 in-scope channels; Shopify + GA4, Klaviyo, Meta Marketing API, Google Ads, Triple Whale) and the Junction root CLAUDE.md goal tracker.",
      "Known: Heather Anderson (founder, taste gate) and Gwyn (product truth) are the two approvers; Fridays 16:00 NZT weekly report.",
      "Baseline is the 28-day revenue reading from 2026-07-12 — refresh from avgar.v_* in the warehouse before it is shown as current.",
      "Unknown: Instagram / TikTok handles (not recorded in the files read), ad budget, gross margin.",
      "The NZ$10K/mo retainer is not an ad budget — budget left unknown.",
    ],
  },
  {
    slug: "home-invasion",
    name: "Home Invasion",
    founder: "Zac",
    website: "https://home1nvasion.com",
    socials: [],
    category: "DTC hip-hop / pop-culture home decor (rugs, plushies)",
    currency: "USD",
    goal: { category: "revenue", title: "US$30,000 monthly revenue", target: 30000, deadline: SIX_MONTHS_OUT, source: "proposed" },
    baseline: null,
    platforms: ["shopify", "klaviyo", "meta_ads"],
    strengths: ["Design", "Product"],
    channels: ["Instagram", "Facebook", "Email / SMS"],
    posture: "paid",
    postureSet: ["paid", "brand"],
    breadth: "focused",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [],
    profile: {
      oneLiner: "Hip-hop and pop-culture home decor — rugs and plushies — sold direct on Shopify; Meta ads are the primary lane.",
      audience: "Hip-hop / streetwear culture buyers",
      region: "Auckland-based, trades in USD and ships worldwide (store meta: country NZ, currency USD)",
      products: ["Rugs", "Plushies"],
    },
    notes: [
      "Source: clients/home-invasion/CHANNELS.md (Shopify, Klaviyo installed, Meta pixel installed, IG handle TBC; in scope: Meta ads primary, email, organic, SEO) and clients/REGISTRY.md.",
      "Known: founder Zac; install started 2026-08-06 on the founder's Claude Max.",
      "Unknown: Instagram handle (TBC in the client file), GA4 property (TBC — not seeded), revenue, budget, margin.",
      "Currency USD — verified 2026-09-02 from the live store (www.home1nvasion.com/meta.json: currency USD, country NZ, myshopify domain home1nvasionstore.myshopify.com; products.json prices e.g. 160.00). Business is Auckland-based.",
      "Goal line is a Junction placeholder — confirm the number. Baseline unknown (NULL).",
    ],
  },
  {
    slug: "rory",
    name: "Rory O'Keefe",
    founder: "Rory O'Keefe",
    website: null,
    socials: [],
    category: "Product design services (consultancy)",
    currency: "NZD",
    goal: { category: "brand", title: "100,000 engaged followers", target: 100000, deadline: "2026-12-31", source: "client-docs" },
    baseline: null,
    platforms: [],
    strengths: ["Video", "Product", "Design"],
    channels: ["Instagram"],
    posture: "brand",
    postureSet: ["brand", "sales"],
    breadth: "focused",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [],
    profile: {
      oneLiner: "Product design services, grown through an Instagram-led founder brand (The Corner daily coaching + weekly leaderboard).",
      audience: "Founders and brands needing product design; Instagram audience for reach",
      region: "NZ",
      products: ["Product design services"],
    },
    notes: [
      "Source: clients/REGISTRY.md (Product design services, Active — AI OS); Junction's The Corner / Rory Corner console-agent work (goals 20K followers Jul 2026 / 100K Dec 2026).",
      "Unknown this session: website, Instagram handle (clients/rory-okeefe/CLIENT-BRIEF.md and THE-PLAN-2026-08-04.md timed out on Drive), current follower count, revenue.",
      "Baseline unknown (NULL) — the rory.v_* views hold the follower series; pull the latest before the invite.",
      "No commerce/email/ads connector known — none seeded.",
    ],
  },
  {
    slug: "aerspan",
    name: "Aerspan Airdomes",
    founder: "Mike Hall-Taylor",
    website: "https://aerspanairdomes.com",
    socials: [],
    category: "B2B air-supported dome buildings (sports & community facilities)",
    currency: "NZD",
    goal: { category: "leads", title: "12 signed dome projects per year", target: 12, deadline: SIX_MONTHS_OUT, source: "client-docs" },
    baseline: { value: 0, asOf: "2026-08-12", source: "clients/aerspan-airdomes/CLAUDE.md — company incorporated 2026, no completed NZ project yet; Counties Tennis at tender/contract stage, not signed" },
    platforms: [],
    strengths: ["Sales conversations", "Email"],
    channels: ["LinkedIn", "Email / SMS"],
    posture: "sales",
    postureSet: ["sales"],
    breadth: "focused",
    budgetMonthly: null,
    hoursWeekly: null,
    grossMarginPct: null,
    team: [
      { name: "Brett", role: "Sales" },
      { name: "Daniel Clapham", role: "Sales" },
    ],
    profile: {
      oneLiner: "Exclusive NZ/Australia/Oceania distributor for DUOL air-supported domes — indoor sports and community facilities, sold against bricks-and-mortar builds.",
      audience: "Clubs, schools, councils and sports trusts that already want an indoor facility and hold ~$10m construction quotes",
      region: "NZ first (Auckland), then Australia",
      products: ["Air-supported dome facilities (DUOL)"],
    },
    notes: [
      "Source: clients/aerspan-airdomes/CLAUDE.md (goal: 12 projects a year, one a month, NZ then AU; team Brett + Daniel Clapham; supplier DUOL; long-cycle named-prospect outreach, draft-only, Mike sends).",
      "Website is the company mailbox domain (aerspanairdomes.com, Microsoft 365) — site existence not verified. Mike's address is not stored here — it is entered on the invite row at invite time.",
      "Baseline 0 is a FOUND fact (no signed/completed NZ project as of 2026-08-12), not a null written as 0.",
      "Deadline is the 6-month horizon; the goal itself is annual (12/yr ≈ 6 signed in the window).",
      "Claims law applies: DUOL's record ≠ Aerspan's; the price wedge is banned from cold email.",
      "No Shopify/Klaviyo/ads; email is Microsoft 365 (GoDaddy-provisioned, federated) — no connector in the registry for it yet.",
    ],
  },
];

// ---------- pure builders ----------

const CONNECTOR_NAME_BY_SLUG: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));
const BELIEF: Record<Posture, string> = { brand: "Brand before sales", sales: "Sales conversations first", paid: "Buy learning fast" };

function money(currency: Currency, n: number): string {
  const sym = currency === "NZD" ? "NZ$" : currency === "AUD" ? "A$" : "US$";
  return `${sym}${Math.round(n).toLocaleString("en-NZ")}`;
}

/** The PlatformState a founder's own onboarding would have left behind, from the facts we hold. */
export function betaState(a: BetaAccount): PlatformState {
  const founderName = a.founder ?? "You";
  const team = [{ name: founderName, role: "Founder", areas: ["Content", "Paid ads", "SEO", "Sales", "Email & SMS"] }, ...a.team.map((t) => ({ name: t.name, role: t.role, areas: [] as string[] }))];
  const connState: Record<string, ConnStatus> = {};
  for (const p of a.platforms) {
    const name = CONNECTOR_NAME_BY_SLUG[p];
    if (name) connState[name] = "off";
  }
  const profile: BusinessProfile = {
    name: a.name,
    oneLiner: a.profile.oneLiner,
    category: a.category,
    products: [...a.profile.products],
    audience: a.profile.audience,
    voice: { tone: null, phrases: [] },
    market: { region: a.profile.region, competitorsMentioned: [] },
    signals: [],
    confidence: "low",
    sources: [a.website, ...a.socials].filter((s): s is string => !!s),
    note: "Seeded by Junction from client files (scripts/seed-beta.ts) — no site scan has run.",
  };
  return {
    ...initialState,
    currency: a.currency,
    goalTitle: a.goal.title,
    deadline: a.goal.deadline,
    obCats: [a.goal.category],
    goalTexts: { ...initialState.goalTexts, [a.goal.category]: a.goal.title },
    targetNum: a.goal.target,
    // stateToRows copies this into goals.baseline: the FOUND value, or NULL (never 0) when unknown.
    baselineNum: a.baseline ? a.baseline.value : null,
    baselineText: a.baseline ? `${a.baseline.value.toLocaleString("en-NZ")} as of ${a.baseline.asOf}` : "",
    budgetMo: a.budgetMonthly ?? 0,
    hoursWk: a.hoursWeekly ?? 0,
    reinvest: "balanced",
    marginPct: a.grossMarginPct ?? initialState.marginPct, // overridden to NULL in betaRows when unknown
    website: a.website ?? "",
    socials: a.socials.join("\n"),
    obStrengths: [...a.strengths],
    obPlatforms: [...a.channels],
    obPostureSet: [...a.postureSet],
    posture: a.posture,
    obBreadth: a.breadth,
    team,
    routineOn: {},
    connState,
    // The three demo approval cards are demo furniture — not persisted (mapping.ts), never shown in accounts mode.
    apStatus: ["held", "held", "held"],
    messages: [
      {
        from: "j",
        text: `Kia ora ${a.founder ? a.founder.split(" ")[0] : "there"} — Tom set this account up from what Junction already knows about ${a.name}, so you're not starting from a blank page. Check the goal and the baseline on the Strategy view, then connect ${a.platforms.length ? a.platforms.map((p) => CONNECTOR_NAME_BY_SLUG[p]).join(", ") : "your platforms"} and I'll start reading. Nothing publishes, sends or spends without your approval.`,
      },
    ],
    humanThread: [{ from: "h", text: "Tom here — this is the human lane. Anything Unc gets wrong, or anything you'd rather say to a person, put it here." }],
    obThread: [],
    routineEdits: {},
    profile: {
      budget: a.budgetMonthly ? `≤ ${money(a.currency, a.budgetMonthly / 30)}/day` : "Not set yet",
      time: a.hoursWeekly ? `${a.hoursWeekly} h/wk` : "Not set yet",
      strength: a.strengths.join(" & "),
      belief: a.postureSet.map((k) => BELIEF[k]).join(" + "),
      team: team.length === 1 ? "Just me" : `${team.length} people`,
    },
    onboarded: true,
    obStep: 6,
    obPace: "Steady · 4 weeks",
    scan: { status: "idle", key: null, profile },
    narrative: { status: "idle", key: null, baseKey: null, value: null },
    wfState: "clean",
    wfVer: initialState.wfVer,
  };
}

/** The rows for one founder. One correction on top of stateToRows: an unknown margin is NULL
    (not the demo 30). An unknown baseline is already NULL (baselineNum null → goals.baseline). */
export function betaRows(a: BetaAccount, accountId: string, now: string): AccountRows {
  const rows = stateToRows(accountId, betaState(a), { now });
  for (const g of rows.goals) if (g.tier === "governing") g.baseline = a.baseline ? a.baseline.value : null;
  rows.resourceProfile.gross_margin_pct = a.grossMarginPct;
  rows.businessProfile.profile = {
    ...rows.businessProfile.profile,
    beta: { slug: a.slug, seeded_at: now, goal_source: a.goal.source, baseline_source: a.baseline?.source ?? null, baseline_as_of: a.baseline?.asOf ?? null, notes: [...a.notes] },
  };
  return rows;
}

// ---------- seeding ----------

export interface SeedOptions {
  /** Print the rows, write nothing. */
  dryRun?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface SeedResult {
  slug: string;
  name: string;
  /** null on a dry run for an account that doesn't exist yet. */
  accountId: string | null;
  created: boolean;
  rows: AccountRows;
}

async function findAccountByName(db: DbClient, name: string): Promise<{ id: string } | null> {
  return unwrap<{ id: string } | null>("accounts.select", db.from("accounts").select("id").eq("name", name).maybeSingle());
}

async function insertAccount(db: DbClient, name: string, currency: Currency): Promise<string> {
  const row = await unwrap<{ id: string }>("accounts.insert", db.from("accounts").insert({ name, currency }).select("id").single());
  return row.id;
}

/** Seed (or re-seed) the beta accounts. Idempotent: keyed on exact accounts.name; every
    section upserts on its natural key (accountState.saveAccountRows), so a second run changes
    nothing but `saved_at`. Membership is not written here (see the header). */
export async function seedBeta(db: DbClient, accounts: BetaAccount[] = BETA_ACCOUNTS, opts: SeedOptions = {}): Promise<SeedResult[]> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const log = opts.log ?? (() => {});
  const out: SeedResult[] = [];
  for (const a of accounts) {
    const existing = await findAccountByName(db, a.name);
    if (opts.dryRun) {
      const rows = betaRows(a, existing?.id ?? "<new>", now);
      log(`[dry-run] ${a.slug} "${a.name}" → ${existing ? `update ${existing.id}` : "create"}`);
      log(JSON.stringify({ account: rows.account, goals: rows.goals, resourceProfile: rows.resourceProfile, teamMembers: rows.teamMembers, connectors: rows.connectors, businessProfile: rows.businessProfile }, null, 2));
      out.push({ slug: a.slug, name: a.name, accountId: existing?.id ?? null, created: false, rows });
      continue;
    }
    const accountId = existing?.id ?? (await insertAccount(db, a.name, a.currency));
    const rows = betaRows(a, accountId, now);
    await saveAccountRows(db, rows, { trustedRuntimeSeed: true });
    // baseline_date has no home in PlatformState; set it on the governing goal directly.
    await unwrap("goals.update", db.from("goals").update({ baseline_date: a.baseline?.asOf ?? null }).eq("account_id", accountId).eq("tier", "governing"));
    log(`${existing ? "updated" : "created"} ${a.slug} "${a.name}" (${accountId}) — goal "${a.goal.title}", baseline ${a.baseline ? a.baseline.value : "unknown (NULL)"}`);
    out.push({ slug: a.slug, name: a.name, accountId, created: !existing, rows });
  }
  return out;
}

// ---------- SQL mode ----------

/* The same rows as seedBeta(), as idempotent SQL for the Supabase Management SQL endpoint
   (POST /v1/projects/<ref>/database/query) or the SQL editor — for when the coordinator has
   the project token but not the service-role key on a machine with node.

   Semantics mirror the seeder: accounts keyed on exact name (insert-if-absent + currency
   update; a duplicate name makes the account subquery fail loudly rather than pick one);
   goals / resource_profiles / business_profiles / team_members / account_state_meta are
   ON CONFLICT DO UPDATE (the seed is the source of truth for those — re-applying after a
   founder edited them overwrites the edit, same as re-running the seeder); connectors,
   chat_messages and plans are insert-only (a live connection, a real thread or an agreed
   plan must never be reset by a re-apply). Membership is not written: the beta_invites rows
   are emitted COMMENTED OUT with an '[EMAIL: …]' placeholder for Tom to fill in — no founder
   email lives in the repo. */

type SqlType = "text" | "num" | "bool" | "jsonb" | "text[]" | "date" | "timestamptz";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function sqlLiteral(v: unknown, t: SqlType = "text"): string {
  if (v === null || v === undefined) return "null";
  switch (t) {
    case "jsonb":
      return `${q(JSON.stringify(v))}::jsonb`;
    case "text[]": {
      const a = (v as unknown[]).map(String);
      return a.length ? `array[${a.map(q).join(", ")}]::text[]` : "'{}'::text[]";
    }
    case "date":
      return `${q(String(v))}::date`;
    case "timestamptz":
      return `${q(String(v))}::timestamptz`;
    case "num":
      return String(Number(v));
    case "bool":
      return v ? "true" : "false";
    default:
      return q(String(v));
  }
}

type Col = [name: string, sql: string];

function insertSql(table: string, cols: Col[], tail: string): string {
  return `insert into ${table} (${cols.map((c) => c[0]).join(", ")})
  values (${cols.map((c) => c[1]).join(", ")})
  ${tail};`;
}
const doUpdate = (keys: string, cols: string[], touch?: string) => `on conflict (${keys}) do update set ${[...cols.map((c) => `${c} = excluded.${c}`), ...(touch ? [`${touch} = now()`] : [])].join(", ")}`;

/** One founder's statements. `acct` is the account-id subquery every row references. */
function accountSql(a: BetaAccount, now: string): string {
  const rows = betaRows(a, "<account>", now);
  const name = q(a.name);
  const acct = `(select id from accounts where name = ${name})`;
  const out: string[] = [];
  out.push(`-- ===== ${a.slug} → ${a.name} =====`);
  out.push(`insert into accounts (name, currency) select ${name}, ${q(a.currency)} where not exists (select 1 from accounts where name = ${name});`);
  out.push(`update accounts set currency = ${q(a.currency)} where name = ${name};`);

  for (const g of rows.goals) {
    const cols: Col[] = [
      ["account_id", acct],
      ["category", q(g.category)],
      ["tier", q(g.tier)],
      ["title", q(g.title)],
      ["baseline", sqlLiteral(g.baseline, "num")],
      ["baseline_date", sqlLiteral(g.tier === "governing" ? (a.baseline?.asOf ?? null) : null, "date")],
      ["deadline", sqlLiteral(g.deadline, "date")],
    ];
    out.push(insertSql("goals", cols, doUpdate("account_id, category", ["tier", "title", "baseline", "baseline_date", "deadline"], "updated_at")));
  }

  const rp = rows.resourceProfile;
  const rpCols: Col[] = [
    ["account_id", acct],
    ["budget_monthly", sqlLiteral(rp.budget_monthly, "num")],
    ["hours_weekly", sqlLiteral(rp.hours_weekly, "num")],
    ["reinvestment", q(rp.reinvestment)],
    ["gross_margin_pct", sqlLiteral(rp.gross_margin_pct, "num")],
    ["website", sqlLiteral(rp.website)],
    ["socials", sqlLiteral(rp.socials, "jsonb")],
    ["skills", sqlLiteral(rp.skills, "text[]")],
    ["known_platforms", sqlLiteral(rp.known_platforms, "text[]")],
    ["postures", sqlLiteral(rp.postures, "text[]")],
    ["breadth", q(rp.breadth)],
  ];
  out.push(insertSql("resource_profiles", rpCols, doUpdate("account_id", rpCols.slice(1).map((c) => c[0]), "updated_at")));

  for (const m of rows.teamMembers) {
    const cols: Col[] = [["account_id", acct], ["position", sqlLiteral(m.position, "num")], ["name", q(m.name)], ["role", q(m.role)], ["approves", sqlLiteral(m.approves)]];
    out.push(insertSql("team_members", cols, doUpdate("account_id, position", ["name", "role", "approves"])));
  }

  const plan = rows.plan;
  out.push(`insert into plans (account_id, title, phases, narrative)
  select ${acct}, ${q(plan.title)}, ${sqlLiteral(plan.phases, "jsonb")}, ${sqlLiteral(plan.narrative)}
  where not exists (select 1 from plans where account_id = ${acct});`);

  const bp = rows.businessProfile;
  const bpCols: Col[] = [["account_id", acct], ["scan_status", q(bp.scan_status)], ["profile", sqlLiteral(bp.profile, "jsonb")], ["scanned_at", sqlLiteral(bp.scanned_at, "timestamptz")]];
  out.push(insertSql("business_profiles", bpCols, doUpdate("account_id", ["scan_status", "profile", "scanned_at"], "updated_at")));

  for (const c of rows.connectors) {
    out.push(insertSql("connectors", [["account_id", acct], ["platform", q(c.platform)], ["status", q(c.status)]], "on conflict (account_id, platform) do nothing"));
  }

  for (const m of rows.chatMessages) {
    const cols: Col[] = [["account_id", acct], ["thread", q(m.thread)], ["position", sqlLiteral(m.position, "num")], ["lane", q(m.lane)], ["sender", q(m.sender)], ["body", q(m.body)], ["meta", sqlLiteral(m.meta, "jsonb")]];
    out.push(insertSql("chat_messages", cols, "on conflict (account_id, thread, position) do nothing"));
  }

  const sm = rows.stateMeta;
  const smCols: Col[] = [["account_id", acct], ["schema_version", sqlLiteral(sm.schema_version, "num")], ["client_state", sqlLiteral(sm.client_state, "jsonb")], ["saved_at", sqlLiteral(now, "timestamptz")]];
  out.push(insertSql("account_state_meta", smCols, doUpdate("account_id", ["schema_version", "client_state", "saved_at"])));

  // The claim — commented out until Tom fills the address in (never stored in the repo).
  const who = a.founder ?? `${a.name} founder`;
  out.push(`-- beta invite (fill the email, uncomment, apply — docs/BETA.md §Invite flow):`);
  out.push(`-- insert into beta_invites (account_id, email, role, invited_by, note)`);
  out.push(`--   select id, lower('[EMAIL: ${who}]'), 'owner', 'tom', ${q(a.slug)} from accounts where name = ${name}`);
  out.push(`--   on conflict (email, account_id) do nothing;`);
  return out.join("\n");
}

/** The whole seed as SQL. Pure; `now` pins seeded_at / saved_at so the output is reproducible. */
export function betaSql(accounts: BetaAccount[] = BETA_ACCOUNTS, now: string = new Date().toISOString()): string {
  const head = [
    `-- Unc beta seed — generated by scripts/seed-beta.ts --sql (${now}). Do not edit by hand; re-generate.`,
    `-- Apply with the service role (Supabase SQL editor, or POST /v1/projects/<ref>/database/query) AFTER`,
    `-- migrations 0001–0009. Idempotent: accounts keyed on exact name; goals / resource_profiles /`,
    `-- business_profiles / team_members / account_state_meta are upserted (the seed wins — re-applying`,
    `-- after a founder edited them overwrites the edit, same as re-running the seeder); connectors,`,
    `-- chat_messages and plans are insert-only (never reset a live connection, a real thread or an`,
    `-- agreed plan). Membership is NOT written: the beta_invites inserts at the end of each block are`,
    `-- commented out with an [EMAIL: …] placeholder — fill the founder's address, uncomment, apply.`,
    `-- Accounts: ${accounts.map((a) => `${a.slug} → "${a.name}"`).join(" · ")}`,
    ``,
  ];
  return [...head, ...accounts.map((a) => accountSql(a, now))].join("\n") + "\n";
}

// ---------- CLI ----------

function parseArgs(argv: string[]): { dryRun: boolean; sql: boolean; only: string[] | null; now: string | null } {
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");
  const sql = argv.includes("--sql");
  const i = argv.indexOf("--only");
  const only = i >= 0 && argv[i + 1] ? argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;
  const n = argv.indexOf("--now");
  const now = n >= 0 && argv[n + 1] ? argv[n + 1] : null;
  if (now && Number.isNaN(new Date(now).getTime())) throw new Error(`--now must be an ISO timestamp, got ${now}`);
  return { dryRun, sql, only, now };
}

async function main(): Promise<void> {
  const { dryRun, sql, only, now } = parseArgs(process.argv.slice(2));
  const accounts = only ? BETA_ACCOUNTS.filter((a) => only.includes(a.slug)) : BETA_ACCOUNTS;
  if (only && accounts.length !== only.length) {
    const known = BETA_ACCOUNTS.map((a) => a.slug).join(", ");
    throw new Error(`--only names an unknown slug; known: ${known}`);
  }
  if (sql) {
    process.stdout.write(betaSql(accounts, now ?? new Date().toISOString()));
    return;
  }
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (process.env — the app never reads .env files)");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as DbClient;
  const results = await seedBeta(db, accounts, { dryRun, now: now ? () => new Date(now) : undefined, log: (l) => console.log(l) });
  console.log(`${dryRun ? "dry run" : "seeded"}: ${results.length} account(s)`);
}

const invokedDirectly = typeof process !== "undefined" && Array.isArray(process.argv) && /seed-beta\.(ts|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
