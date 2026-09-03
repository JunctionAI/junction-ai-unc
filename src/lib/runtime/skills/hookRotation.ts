/* D02-W03 Hook rotation engine → generic (swap a tired hook, or flag for content). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const hookRotation: Skill = {
  id: "D02-W03",
  routineId: "D02-W03",
  name: "Hook rotation engine",
  kind: "generic",
  maxItems: 1,
  purpose: "One recommendation to rotate a fresh hook into a fatigued ad — or to flag that none is ready",
  inputs: ["ad insights with frequency and CTR (Meta Ads — required)", "paused hook variants (Meta Ads, when tagged)"],
  file: {
    goal: "One hook-rotation recommendation with the tired ad's numbers and a named rollback",
    owns: ["the rotate-or-flag recommendation"],
    reads: ["ad-level frequency and CTR", "paused hook variants when present"],
    decides: ["which ad is past its hook life", "whether a variant is ready to swap"],
    writes: ["a generic artifact of one Would-card"],
    never: ["invent frequency, CTR or days live", "rotate a hook live without approval", "spend"],
    apply: "Would-cards only. The exact rotation needs a separate run-level approval gate; I never spend.",
    examples: [
      { when: "an ad at frequency 4.6 with CTR down and a paused Hook v5", does: "one rotate item naming both ads, numbers from the rows, rollback = pause the new and resume the old" },
      { when: "fatigue is visible but no paused variant", does: "one item flagging the tired ad for the content engine, no invented next hook" },
    ],
  },
  minimum: minimum("Meta Ads with ad-level frequency and CTR", ["meta_ads"], []),
  domain: "paid",
  prompt: `CRAFT — hook rotation:
- One item. Name the fatigued ad from the ads rows (highest frequency, or CTR sliding when that field exists). Title: rotate into <ad> — or "no fresh hook ready" when the hooks rows are empty.
- Evidence only from the rows: frequency, CTR, ctr_trend, days_live, spend. Cite a number only if it is on the row or in the read's metrics. Never invent frequency, CTR, ROAS, CPA or days live.
- If a paused hook variant is in the hooks rows, name it (ad_id / creative_id from the row) as the swap. If none, say so and point the next hook at the content engine — do not invent a hook line.
- Rollback named: pause the new ad and resume the old (meta.ad.rotate the other way). This is a Would-card; Unc never spends or rotates live.
- meta: { action: "rotate" | "flag", ad_id: "<fatigued, from the row or null>", next_ad_id: "<from hooks or null>", rollback: "pause the new, resume the old" }.`,
  outputSpec: `{"kind":"generic","title":"Hook rotation: <ad name or none ready>","body":"which ad is tired, the numbers that are present, whether a variant is ready","items":[{"title":"<rotate|flag>: <ad>","body":"<evidence + next hook or content-engine ask + rollback, markdown>","meta":{"action":"rotate|flag","ad_id":null,"next_ad_id":null,"rollback":"pause the new, resume the old"}}],"evidence":[{"source":"read:ads|read:hooks","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "ads")) return { ok: false, needs: [need.platform("meta_ads", "ad-level frequency and CTR so I can see which hook is tired")] };
    const ads = rows(ctx, "ads").length;
    if (!ads) return { ok: false, needs: [need.platform("meta_ads", "ad-level frequency and CTR so I can see which hook is tired")], note: "No ads in the window." };
    const using = [`${ads} ads`];
    const hooks = rows(ctx, "hooks").length;
    if (hooks) using.push(`${hooks} hook variants`);
    return { ok: true, using };
  },
};
