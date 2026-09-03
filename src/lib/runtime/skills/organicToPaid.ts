/* D02-W08 Organic-to-paid promotion → generic (boost a proven post, or wait). */
import { minimum, need, rows, type Skill } from "./types";

export const organicToPaid: Skill = {
  id: "D02-W08",
  routineId: "D02-W08",
  name: "Organic-to-paid promotion",
  kind: "generic",
  maxItems: 1,
  purpose: "One recommendation to run a proven Instagram post as a paid test — or to wait until demand, not just reach, shows",
  inputs: ["Instagram post insights (required, or a pasted source post)", "GA4 Instagram conversions (helpful)"],
  file: {
    goal: "One organic-to-paid recommendation: promote the proven post, or wait",
    owns: ["the promote-or-skip recommendation"],
    reads: ["Instagram reach, plays, likes, saves", "GA4 conversions when connected", "a pasted source post"],
    decides: ["which post proved demand", "whether to promote or wait"],
    writes: ["a generic artifact of one Would-card"],
    never: ["invent conversions, reach or like-rate", "publish the paid test", "spend"],
    apply: "Would-cards only. I never spend; any future promotion needs a separate exact run-level approval gate.",
    examples: [
      { when: "top post has reach and saves, GA4 shows Instagram conversions", does: "one promote item naming that post, those numbers, rollback = created PAUSED" },
      { when: "founder pastes a post and GA4 is off", does: "one item from the paste; conversions omitted, never invented" },
    ],
  },
  minimum: minimum("a proven Instagram post — from insights or pasted by you", ["instagram"], ["source_post"], ["ga4"]),
  domain: "paid",
  prompt: `CRAFT — organic to paid:
- One item. Pick the strongest Instagram post from the posts rows (reach, saves, like-rate when present) or the source_post the founder pasted. Title names the post; verdict is promote or skip.
- Demand, not just reach: cite reach, plays, likes, saves, shares only if they are on the row. Cite conversions only if the GA4 read has them. If conversions are missing, say they are not measured yet and prefer skip unless the founder pasted the post to promote. Never invent conversions, reach, like-rate, ROAS, spend, frequency or CPA.
- Promote is a Would-card for a 7-day paid test created PAUSED. Do not invent a daily budget; name one only if it is in vars or the decision, otherwise say the founder sets it.
- Rollback named: everything is created PAUSED; switch it off in Ads Manager. Unc never spends and never publishes.
- meta: { action: "promote" | "skip", media_id: "<from the row or null>", rollback: "created PAUSED; switch it off in Ads Manager" }.`,
  outputSpec: `{"kind":"generic","title":"Organic-to-paid: <promote|skip> <post>","body":"which post, the organic numbers that are present, conversions only if GA4 measured them","items":[{"title":"<promote|skip>: <post hook>","body":"<evidence + budget-if-present + rollback, markdown>","meta":{"action":"promote|skip","media_id":null,"rollback":"created PAUSED; switch it off in Ads Manager"}}],"evidence":[{"source":"read:posts|read:ga|input:source_post|vars","ref":"…"}]}`,
  check(ctx) {
    const posts = rows(ctx, "posts").length;
    const using: string[] = [];
    if (posts) using.push(`${posts} Instagram posts`);
    if (rows(ctx, "ga").length) using.push("GA4 Instagram conversions");
    if (ctx.inputs.source_post) using.push("the post you pasted");
    if (posts || ctx.inputs.source_post) return { ok: true, using };
    return { ok: false, needs: [need.platform("instagram", "organic posts with reach and saves"), need.input("source_post", "or paste the post URL or caption you want to promote")] };
  },
};
