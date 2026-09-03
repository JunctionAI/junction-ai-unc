/* D02-W04 Ad fatigue watch → generic (pause the tired ad, or keep). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const adFatigue: Skill = {
  id: "D02-W04",
  routineId: "D02-W04",
  name: "Ad fatigue watch",
  kind: "generic",
  maxItems: 1,
  purpose: "One recommendation to pause a saturated, over-CPA ad — or to keep it when spend is too small to judge",
  inputs: ["ad insights with frequency, CPA and spend (Meta Ads — required)"],
  file: {
    goal: "One fatigue recommendation: pause the tired ad, or keep it running",
    owns: ["the pause-or-keep recommendation"],
    reads: ["ad-level frequency, CPA, spend"],
    decides: ["which ad is both saturated and expensive", "whether spend is large enough to pause"],
    writes: ["a generic artifact of one Would-card"],
    never: ["invent frequency, CPA or spend", "pause an ad without approval", "spend"],
    apply: "Would-cards only. Any future pause needs a separate exact run-level approval gate; I never spend.",
    examples: [
      { when: "worst ad frequency 5 and CPA 60% over target on enough spend", does: "one pause item naming that ad, those numbers, rollback = meta.ad.resume" },
      { when: "frequency is high but spend is tiny", does: "one keep item — spend too small to judge, no invented pause" },
    ],
  },
  minimum: minimum("Meta Ads with ad-level frequency and CPA", ["meta_ads"], []),
  domain: "paid",
  prompt: `CRAFT — ad fatigue:
- One item. Name the tired ad from the ads rows (worst frequency, or CPA climbing when that field exists). Verdict is pause or keep.
- Evidence only from the read: frequency, CPA, cpa_trend, spend, the worst_* metrics when present. Cite a % over target only if worst_cpa_vs_target_pct (or equivalent) is in the metrics. Never invent frequency, CPA, spend or ROAS.
- Pause only when the rows show both saturation and cost; if spend is missing or too small to judge, verdict is keep and say so. Do not invent a spend floor.
- Rollback named: meta.ad.resume. This is a Would-card; Unc never pauses live and never spends.
- meta: { action: "pause" | "keep", ad_id: "<from the row or null>", ad_name: "…", rollback: "meta.ad.resume" }.`,
  outputSpec: `{"kind":"generic","title":"Fatigue: <pause|keep> <ad name>","body":"the frequency/CPA/spend that are present and why this verdict","items":[{"title":"<pause|keep>: <ad>","body":"<evidence + rollback, markdown>","meta":{"action":"pause|keep","ad_id":null,"ad_name":"…","rollback":"meta.ad.resume"}}],"evidence":[{"source":"read:ads","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "ads")) return { ok: false, needs: [need.platform("meta_ads", "ad-level frequency and CPA — I don't invent fatigue")] };
    const ads = rows(ctx, "ads").length;
    if (!ads) return { ok: false, needs: [need.platform("meta_ads", "ad-level frequency and CPA — I don't invent fatigue")], note: "No ads in the window." };
    return { ok: true, using: [`${ads} ads`] };
  },
};
