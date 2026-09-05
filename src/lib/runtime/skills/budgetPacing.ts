/* D02-W07 Budget pacing guard → generic (cut the largest set, or pacing is fine). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const budgetPacing: Skill = {
  id: "D02-W07",
  routineId: "D02-W07",
  name: "Budget pacing guard",
  kind: "generic",
  maxItems: 1,
  purpose: "One recommendation to pull today's Meta spend back under the daily cap — or to leave pacing alone",
  inputs: ["today's Meta account insights (required)", "Google Ads campaigns (helpful, often unavailable)", "month-to-date Meta spend", "ad set budgets"],
  file: {
    goal: "One pacing recommendation: cut the largest ad set, or leave budgets as they are",
    owns: ["the cut-or-fine recommendation"],
    reads: ["today's Meta spend vs daily budget", "Google Ads when a reader answers", "MTD spend", "ad set budgets"],
    decides: ["whether projected spend is over the cap", "which ad set to cut"],
    writes: ["a generic artifact of one Would-card"],
    never: ["invent spend, a pacing % or a cap", "cut a budget without approval", "spend"],
    apply: "Would-cards only. I never spend; any future budget change needs a separate exact run-level approval gate.",
    examples: [
      { when: "Meta projected daily spend is over the cap and Prospecting is the largest set", does: "one cut item naming that set, the Meta numbers, rollback = restore the previous daily budget" },
      { when: "Google Ads is unavailable", does: "pace on Meta rows alone — never invent a Google cost" },
    ],
  },
  minimum: minimum("today's Meta account spend vs the daily cap", ["meta_ads"], [], ["google_ads"]),
  domain: "paid",
  prompt: `CRAFT — budget pacing:
- One item. Verdict is cut (pull the largest ad set back under the cap) or fine (pacing inside the cap). Meta rows alone are enough; Google Ads is helpful only when those rows exist.
- Cite only numbers present on the meta / mtd / adsets (and google, when answered) reads: spend, projected_daily_spend, largest_adset_*. active_daily_budget_total is an active-object configuration subset, never a whole-account cap or a projected spend value. Never substitute it or the retired daily_budget_total for a forecast. Name the cap only if it is in vars or caps-equivalent material; otherwise do not claim a cut-or-fine comparison. Never invent spend, a pacing %, ROAS, CPA or frequency.
- If Google rows are missing or provenance is unavailable, do not mention Google spend. Do not invent a blended number.
- Rollback named: restore the previous daily budget. This is a Would-card; Unc never spends and never cuts live.
- meta: { action: "cut" | "fine", adset_id: "<largest, from the row or null>", adset_name: "…", rollback: "restore the previous daily budget" }.`,
  outputSpec: `{"kind":"generic","title":"Pacing: <cut|fine>","body":"today's Meta numbers that are present, Google only if read, why this verdict","items":[{"title":"<cut|fine>: <ad set or account>","body":"<evidence + rollback, markdown>","meta":{"action":"cut|fine","adset_id":null,"adset_name":"…","rollback":"restore the previous daily budget"}}],"evidence":[{"source":"read:meta|read:google|read:mtd|read:adsets|vars","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "meta")) return { ok: false, needs: [need.platform("meta_ads", "today's account spend vs daily budget — I don't invent pacing")] };
    const meta = rows(ctx, "meta").length;
    if (!meta) return { ok: false, needs: [need.platform("meta_ads", "today's account spend vs daily budget — I don't invent pacing")], note: "No Meta spend to pace against." };
    const projection = ctx.reads.meta.metrics.projected_daily_spend;
    if (ctx.reads.meta.provenance !== "ok" || typeof projection !== "number" || !Number.isFinite(projection) || projection < 0) {
      return { ok: false, needs: [need.input("verified_daily_spend_projection", "a verified account spend forecast, not the sum of configured ad-set budgets")], note: "Budget configurations alone do not establish spend pacing." };
    }
    const using = [`${meta} Meta account rows`];
    if (rows(ctx, "google").length) using.push("Google Ads campaigns");
    if (rows(ctx, "mtd").length) using.push("month-to-date spend");
    if (rows(ctx, "adsets").length) using.push("ad set budgets");
    return { ok: true, using };
  },
};
