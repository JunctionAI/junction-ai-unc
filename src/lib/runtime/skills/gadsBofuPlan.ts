/* D02-W09 Google Ads BOFU campaign plan → generic (a PAUSED-only Search plan for ONE market).
   Draft only: a plan is never a created, edited or activated campaign. */
import { knowsTheBusiness, minimum, need, readAnswered, rows, type Skill } from "./types";

export const BOFU_MARKETS = ["US", "NZ", "AU"] as const;

export const gadsBofuPlan: Skill = {
  id: "D02-W09",
  routineId: "D02-W09",
  name: "Google Ads BOFU campaign plan",
  kind: "generic",
  maxItems: 5,
  purpose: "A bottom-of-funnel Search campaign plan for one market, grounded in observed keyword demand, staged PAUSED and never created",
  inputs: [
    "the seed keyword and the ONE market this plan is for (US, NZ or AU)",
    "observed keyword demand for that market (volume, CPC, competition, intent) when a provider read exists",
    "existing Google Ads campaigns and search terms (when connected)",
    "the verified promoted product and its current selling price in the account currency",
    "site profile and approved business memories",
  ],
  file: {
    goal: "One market's BOFU Search plan: ad groups, keywords with match types, negatives, RSA copy and PAUSED campaign settings",
    owns: ["the proposed ad-group structure, keyword list, match types and negatives", "the proposed RSA headlines and descriptions", "the plan's stated CPA ceiling"],
    reads: ["seed keyword and market inputs", "observed keyword metrics when a provider read exists", "Google Ads campaigns and search terms when connected", "site profile and memories"],
    decides: ["which observed keywords carry transactional intent for this market", "which negatives protect spend", "the ceiling: 50% of the verified product price in the same currency, or hold when unknown"],
    writes: ["one generic artifact: the plan, staged PAUSED, with every observed metric labelled by source"],
    never: ["create, edit, enable or pause a Google Ads campaign, ad group, keyword or budget", "invent search volume, CPC, competition, conversion data or a product price", "mix markets in one plan or reuse another market's location code", "state a CPA ceiling without the verified product price in the same currency"],
    apply: "Plans only. Any Google Ads write needs a typed action, a separate exact approval and a login-customer-id / conversion-action binding that does not exist yet.",
    examples: [
      { when: "DataForSEO reports demand for the seed in the US and the promoted product's USD price is verified", does: "one PAUSED Search plan with phrase/exact groups, negatives, RSA copy and a CPA ceiling of half the price" },
      { when: "the market price is unknown or only known in another currency", does: "the same structural plan with the ceiling held as pending_product_price, never a converted or store-wide number" },
    ],
  },
  minimum: minimum("the seed keyword, the one market this plan is for, and enough approved business context", [], ["campaign_seed_keyword", "campaign_market"], ["google_ads"]),
  domain: "paid",
  prompt: `CRAFT — BOFU Search plan for one market:
- Exactly one market per plan: campaign_market must be US, NZ or AU. Never blend markets, location codes or currencies.
- Every keyword line names its match type (EXACT | PHRASE | BROAD). Cite search volume, CPC, competition and intent only when a read supplies them; a missing metric is null, never a guess.
- Negatives protect spend: list the terms to exclude and why. Landing pages must be on the account's own verified domain.
- RSA copy: up to 15 headlines (≤ 30 characters) and 4 descriptions (≤ 90 characters), written from the site profile and memories, no claims the business has not made.
- The CPA ceiling is 50% of the verified promoted product's price in the SAME currency. If that price is not verified, write "ceiling: pending product price" and do not compute one from another currency, a compare-at price or store-wide AOV.
- Campaign settings are always PAUSED. State clearly that nothing is created in Google Ads; login-customer-id and conversion-action bindings are unresolved until a founder-approved write exists.
- meta per item: { campaign_status: "PAUSED", market: "US"|"NZ"|"AU", ad_group: "…", keywords: [{ keyword, match_type, search_volume, cpc, competition, intent }], negatives: [...], landing_url: "https://…", headlines: [...], descriptions: [...], cpa_ceiling: { value, currency, product_price } | null, mutate_attempted: false }.
- End the body with PASS, PARTIAL or BLOCKED for plan readiness and the smallest next decision.`,
  outputSpec: `{"kind":"generic","title":"BOFU Search plan — <market>: <seed keyword>","body":"the observed demand this plan rests on, the ceiling rule, what is unknown, and PASS|PARTIAL|BLOCKED","items":[{"title":"<ad group>","body":"<keywords + match types, negatives, RSA copy, landing page, PAUSED settings, markdown>","meta":{"campaign_status":"PAUSED","market":"US","ad_group":"…","keywords":[{"keyword":"…","match_type":"PHRASE","search_volume":null,"cpc":null,"competition":null,"intent":null}],"negatives":[],"landing_url":"https://…","headlines":[],"descriptions":[],"cpa_ceiling":null,"mutate_attempted":false}}],"evidence":[{"source":"input:campaign_seed_keyword|input:campaign_market|read:campaigns|read:terms|site_profile|memory","ref":"…"}]}`,
  check(ctx) {
    const needs = [];
    const seed = ctx.inputs.campaign_seed_keyword?.trim();
    const market = ctx.inputs.campaign_market?.trim().toUpperCase();
    if (!seed) needs.push(need.input("campaign_seed_keyword", "the seed keyword this plan is built around — I don't pick one for you"));
    if (!market || !(BOFU_MARKETS as readonly string[]).includes(market)) needs.push(need.input("campaign_market", "the ONE market for this plan: US, NZ or AU"));
    const business = knowsTheBusiness(ctx);
    if (!business.ok && !ctx.inputs.about_the_business?.trim()) needs.push(need.input("about_the_business", "what you sell and to whom, so the copy is yours"));
    if (needs.length) return { ok: false, needs };
    const using = [...business.using, `${market} market`, "your seed keyword"];
    if (ctx.inputs.about_the_business?.trim()) using.push("your note about the business");
    if (readAnswered(ctx, "campaigns") && rows(ctx, "campaigns").length) using.push(`${rows(ctx, "campaigns").length} Google Ads campaigns`);
    if (readAnswered(ctx, "terms") && rows(ctx, "terms").length) using.push(`${rows(ctx, "terms").length} search terms`);
    return { ok: true, using };
  },
};
