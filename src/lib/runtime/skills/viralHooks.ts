/* D01-W02 Viral hook mining → hook_list (niche breakouts → brand-fit hook library). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const viralHooks: Skill = {
  id: "D01-W02",
  routineId: "D01-W02",
  name: "Viral hook mining",
  kind: "hook_list",
  maxItems: 8,
  purpose: "This week's breakout hooks in the niche, stripped to a fill-in-the-blank skeleton the brand can pour into",
  inputs: ["TikTok breakout videos in the niche (when connected)", "Instagram hashtag posts (when connected)", "vars.niche and vars.hashtags", "site profile (voice, products) as a hypothesis fallback"],
  file: {
    goal: "A hook library of up to eight brand-fit skeletons, measured when the rows exist",
    owns: ["the hook_list artifact", "measured vs hypothesis labels"],
    reads: ["TikTok niche videos", "Instagram hashtag posts", "site profile / founder note when the social reads are empty"],
    decides: ["which breakout mechanics transfer to this brand", "which eight to keep"],
    writes: ["a hook_list artifact"],
    never: ["invent view counts, likes or play numbers", "publish", "treat a hypothesis hook as a measured breakout"],
    apply: "Drafts. I keep handing hook skeletons until you keep the same mechanics — I still don't post; you do.",
    examples: [
      { when: "a scanned physio site, no TikTok connected", does: "eight hypothesis hooks from the niche + voice, every item status hypothesis" },
      { when: "12 TikTok rows with view counts", does: "skeletons from those captions, status measured, views cited from the row only" },
    ],
  },
  minimum: minimum("a scanned site profile or a note about the niche; TikTok / Instagram rows turn a hypothesis into a measured library", [], ["about_the_business"], ["tiktok", "instagram"]),
  domain: "content",
  prompt: `CRAFT — viral hooks:
- I write at most eight items. Each item is a fill-in-the-blank skeleton (hook mechanic → angle → first-line spoken or on-screen text) the founder can pour the product into — not a finished ad, not a caption dump.
- Without TikTok/Instagram breakout rows I still produce a hypothesis library from vars.niche (or the profile's category) and the brand voice. I say so in the body. Every item's meta.status is "hypothesis". I never pretend I watched the niche this week.
- With niche or ig rows I rank by the view/play numbers that are ON the row, mark those items "measured", and cite those counts only. No estimated reach. A row without a view number gets views: null.
- I decouple the mechanic from the topic: curiosity gap, conflicting claim, open loop, pattern interrupt — named in meta.mechanic. Then I pour THIS brand's products, audience and phrases into the blank. Where a strong line needs a fact I don't have, I write [needs a real fact: what would make this true].
- Facts only from the material. No invented volumes, views, rates or discounts. Live mode stays off: I don't publish.
- meta per item: { status: "hypothesis" | "measured", mechanic: "…", views: <number from the row or null>, source: "tiktok" | "instagram" | "brand" }.`,
  outputSpec: `{"kind":"hook_list","title":"<n> hooks for <niche>","body":"where the hooks came from (breakout rows vs hypothesis) and the mechanic pattern","items":[{"title":"<the hook line>","body":"<skeleton + why it fits + how to shoot it>","meta":{"status":"hypothesis","mechanic":"…","views":null,"source":"…"}}],"evidence":[{"source":"read:niche|read:ig|site_profile|input:about_the_business","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const niche = rows(ctx, "niche").length;
    const ig = rows(ctx, "ig").length;
    if (niche) using.push(`${niche} TikTok breakouts`);
    if (ig) using.push(`${ig} Instagram posts`);
    if (ctx.vars.niche) using.push(`niche ${String(ctx.vars.niche)}`);
    if (ctx.vars.hashtags) using.push(`hashtags ${String(ctx.vars.hashtags)}`);
    if (ctx.inputs.about_the_business) using.push("your note");
    if (base.ok || ctx.inputs.about_the_business || niche || ig) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
