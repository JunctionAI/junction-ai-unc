/* D02-W01 Daily paid decisioning → generic (today's scale | turn_off | hold). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const dailyPaid: Skill = {
  id: "D02-W01",
  routineId: "D02-W01",
  name: "Daily paid decisioning",
  kind: "generic",
  maxItems: 1,
  purpose: "Today's one paid verdict — scale, turn off or hold — reasoned from certified 7-day spend, never a live budget move",
  inputs: ["ad-set insights (Meta Ads — required)", "ad set budgets and status (Meta Ads)", "Shopify orders to reconcile against (required)", "GA4 Facebook campaign report (when connected)", "the account's Meta preset in vars"],
  file: {
    goal: "One verdict for today: scale the winner, turn off a loser, or hold",
    owns: ["today's scale | turn_off | hold verdict", "the reasoning line from the spend read"],
    reads: ["Meta ad-set spend (7d)", "ad set budgets", "Shopify orders", "GA4 when connected", "the preset in vars"],
    decides: ["which ad set the verdict names", "scale vs turn_off vs hold from the numbers that are present"],
    writes: ["a generic artifact of one recommendation (a Would-card)"],
    never: ["invent a reconciliation %, ROAS, spend or CPA", "apply a budget move", "spend"],
    apply: "Would-cards only. I never spend; any future move needs a separate exact run-level approval gate.",
    examples: [
      { when: "Prospecting NZ holds 7-day ROAS above the preset floor", does: "one scale item naming that ad set, the spend and ROAS from the read, rollback = restore the previous daily budget" },
      { when: "reconciliation_pct is null on the spend read", does: "cite spend and ROAS only — never mention a reconciliation %" },
    ],
  },
  minimum: minimum("Meta Ads spend this week plus Shopify orders to reconcile against", ["meta_ads", "shopify"], [], ["ga4"]),
  domain: "paid",
  prompt: `CRAFT — today's paid verdict:
- One item only: today's verdict for one ad set. Title names the ad set and the verdict (scale | turn_off | hold). Body is the reasoning line — preset first when vars carry one, then the numbers from the spend read.
- Cite only metrics that are present on the spend (or orders / GA4) read: spend, purchases, purchase_value, ROAS, frequency, CTR, daily_budget, CPA. If a metric is missing, skip it. If reconciliation_pct is null or absent, do not mention a reconciliation % at all.
- Never invent ROAS, spend, frequency, CPA or a reconciliation %. Never pick a second ad set. Never apply a budget move — this is a Would-card; Unc does not spend.
- Rollback named in the body: restore the previous daily budget (scale) or resume the ad set (turn_off); hold has no mutation.
- meta: { verdict: "scale" | "turn_off" | "hold", adset_id: "<from the row or null>", adset_name: "…", rollback: "…" }.`,
  outputSpec: `{"kind":"generic","title":"Today: <verdict> <ad set>","body":"the 7-day numbers that are present and why this verdict, no invented reconciliation %","items":[{"title":"<verdict>: <ad set>","body":"<reasoning + rollback, markdown>","meta":{"verdict":"scale|turn_off|hold","adset_id":null,"adset_name":"…","rollback":"…"}}],"evidence":[{"source":"read:spend|read:adsets|read:orders|read:ga|vars","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "spend")) return { ok: false, needs: [need.platform("meta_ads", "7-day ad-set spend is the material — I don't invent ROAS or CPA")] };
    const spendRows = rows(ctx, "spend");
    const spendVal = ctx.reads.spend?.metrics?.spend;
    const spendNum = typeof spendVal === "number" ? spendVal : Number(spendVal);
    if (!spendRows.length || !Number.isFinite(spendNum) || spendNum === 0) {
      return { ok: false, needs: [need.platform("meta_ads", "7-day ad-set spend is the material — I don't invent ROAS or CPA")], note: "No paid spend in the last 7 days" };
    }
    const using = [`${spendRows.length} ad sets`];
    if (rows(ctx, "adsets").length) using.push("ad set budgets");
    if (rows(ctx, "orders").length) using.push(`${rows(ctx, "orders").length} Shopify orders`);
    if (readAnswered(ctx, "ga") && rows(ctx, "ga").length) using.push("GA4 campaign report");
    return { ok: true, using };
  },
};
