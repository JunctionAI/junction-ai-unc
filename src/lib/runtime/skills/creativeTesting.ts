/* D02-W02 Creative testing sprints → generic (three creatives for this week's cell). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const creativeTesting: Skill = {
  id: "D02-W02",
  routineId: "D02-W02",
  name: "Creative testing sprints",
  kind: "generic",
  maxItems: 3,
  purpose: "This week's three-creative test cell, named from the rows that are waiting — never launched without approval",
  inputs: ["ad insights (Meta Ads — required)", "paused test-ready creatives (Meta Ads)", "sprint budget in vars or the decision, when set"],
  file: {
    goal: "Three named creatives for this week's test cell, waiting on approval",
    owns: ["the three-creative test cell", "which paused creatives go in"],
    reads: ["Meta ad insights", "paused creatives tagged test-ready", "sprint budget in vars when set"],
    decides: ["which three creatives run", "the angle each one tests"],
    writes: ["a generic artifact of three Would-cards"],
    never: ["invent CPA, spend or a creative name", "launch a test without approval", "spend"],
    apply: "Would-cards only. I never launch a test; any future launch needs a separate exact run-level approval gate.",
    examples: [
      { when: "three paused creatives named Hook v4 / v5 / v6", does: "one item each, titles from the rows, sprint budget only if vars carry it" },
      { when: "no sprint budget in vars", does: "say the founder sets the sprint budget — never invent $30/day" },
    ],
  },
  minimum: minimum("Meta Ads with live ads and test-ready creatives", ["meta_ads"], []),
  domain: "paid",
  prompt: `CRAFT — this week's creative test:
- Three items, one per creative, named from the creatives (or ads) rows — the ad_name / name on the row, never a made-up title. If fewer than three named rows exist, write only as many as you have; do not invent a fourth concept or fill with "Creative A".
- Each item: what concept it tests (hook / format / offer — only if those fields are on the row or obvious from the name), and the 14-day numbers that are present (spend, CTR, CPA, purchases). Missing metric → skip it. Never invent ROAS, spend, frequency or CPA.
- Sprint budget: name it only if it is in vars or the decision. Otherwise say the founder sets the sprint budget. Do not write a dollar amount that is not in the material.
- This is a Would-card. Never launch, never spend. Rollback: everything is created PAUSED; switch it off in Ads Manager.
- meta per item: { creative_id: "<from the row or null>", ad_name: "…", role: "hook" | "format" | "offer" | "control" }.`,
  outputSpec: `{"kind":"generic","title":"Creative test: <3 names in five words>","body":"which three creatives, from which rows, and the sprint budget only if vars/decision named it","items":[{"title":"<ad name from the row>","body":"<concept + present numbers + rollback, markdown>","meta":{"creative_id":null,"ad_name":"…","role":"…"}}],"evidence":[{"source":"read:ads|read:creatives|vars","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "ads") && !readAnswered(ctx, "creatives")) {
      return { ok: false, needs: [need.platform("meta_ads", "live ads and paused test-ready creatives — I don't invent the three names")] };
    }
    const ads = rows(ctx, "ads").length;
    const creatives = rows(ctx, "creatives").length;
    if (!ads && !creatives) {
      return { ok: false, needs: [need.platform("meta_ads", "live ads and paused test-ready creatives — I don't invent the three names")], note: "No ads or test-ready creatives in the window." };
    }
    const using: string[] = [];
    if (ads) using.push(`${ads} ads`);
    if (creatives) using.push(`${creatives} test-ready creatives`);
    return { ok: true, using };
  },
};
