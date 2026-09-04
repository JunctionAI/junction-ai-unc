/* D01-W07 Trend watch → post_set (rising trends → 3 brand-fit post ideas; 24h expiry). */
import { knowsTheBusiness, minimum, need, profileHasSubstance, rows, type Skill } from "./types";

export const trendWatch: Skill = {
  id: "D01-W07",
  routineId: "D01-W07",
  name: "Trend watch",
  kind: "post_set",
  maxItems: 3,
  purpose: "Three brand-fit post ideas on trends that are still rising today — they expire fast",
  inputs: ["TikTok rising trends in vars.region / vars.niche (when connected)", "TikTok rising sounds (when connected)", "a niche the founder names", "site profile (voice, products) for hypothetical angles"],
  file: {
    goal: "Three post ideas on trends still rising — labelled expired-by-tomorrow",
    owns: ["the three-idea post_set", "rising vs hypothetical labels"],
    reads: ["TikTok trends", "TikTok sounds", "vars.region and vars.niche", "site profile when the trend read is empty"],
    decides: ["which rising trends the brand can ride credibly", "the angle that doesn't fake belonging"],
    writes: ["a post_set of three items"],
    never: ["invent a growth_rate or video_count", "publish", "treat a hypothetical angle as a rising trend"],
    apply: "Drafts. These expire in a day — I ask again tomorrow rather than pretend a trend is still rising.",
    examples: [
      { when: "no TikTok connected, niche 'physio' on the profile", does: "three 'if this sound is rising' angles, every item status hypothetical, no growth_rate" },
      { when: "three rising trend rows with growth_rate", does: "one post idea each, rate cited from the row, body says they expire today" },
    ],
  },
  minimum: minimum("rising TikTok trends in your niche — or the niche itself so I can draft hypothetical angles", [], ["niche"], ["tiktok"]),
  domain: "content",
  prompt: `CRAFT — trend watch:
- I write exactly three post ideas, each ready to shoot today. Body leads with the expiry: these ideas go stale within a day. A trend that is still rising this morning may be gone tomorrow — I say that in the body, every time.
- Only rows in reads.trends / reads.sounds count as rising. I pick trends that are rising in the material, and only those. growth_rate and video_count are copied from the row or left null. I never invent a growth_rate, a view count or a "how fast it's growing".
- Without trend/sound rows I draft three "if this sound is rising" angles from vars.niche (or the niche the founder typed, or the profile's category) plus the brand voice. Every item's meta.status is "hypothetical". I say so in the body. I do not name a real sound or a real trend I did not read.
- Each item: a hook the founder can say in the first two seconds, a 60–90 word script or caption in the brand's voice, and why this brand can ride it without faking belonging. Where a line needs a fact I don't have, I write [needs a real fact: what would make this true].
- Facts only from the material. No invented volumes, views, rates or discounts. I don't publish. Live mode stays off.
- meta per item: { trend: "<from the row or 'if this sound is rising'>", status: "rising" | "hypothetical", growth_rate: <from the row or null>, platform: "tiktok" }.`,
  outputSpec: `{"kind":"post_set","title":"3 trend ideas (expire today)","body":"these expire fast — only ride a trend still rising; where each idea came from","items":[{"title":"<hook>","body":"<the post/script>","meta":{"trend":"…","status":"hypothetical","growth_rate":null,"platform":"tiktok"}}],"evidence":[{"source":"read:trends|read:sounds|site_profile|input:niche","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const trends = rows(ctx, "trends").length;
    const sounds = rows(ctx, "sounds").length;
    if (trends) using.push(`${trends} rising trends`);
    if (sounds) using.push(`${sounds} sounds`);
    const niche = (typeof ctx.vars.niche === "string" && ctx.vars.niche.trim() ? ctx.vars.niche : ctx.inputs.niche) ?? "";
    if (niche) using.push(`niche ${niche}`);
    if (ctx.vars.region) using.push(`region ${String(ctx.vars.region)}`);
    const base = knowsTheBusiness(ctx);
    using.push(...base.using);
    if (ctx.inputs.about_the_business) using.push("your note");
    if (trends || sounds) return { ok: true, using };
    if (niche || base.ok || ctx.inputs.about_the_business || profileHasSubstance(ctx.profile)) return { ok: true, using };
    return { ok: false, needs: [need.input("niche", "tell me the niche / category to watch — or connect TikTok and I'll read what's rising today")] };
  },
};
