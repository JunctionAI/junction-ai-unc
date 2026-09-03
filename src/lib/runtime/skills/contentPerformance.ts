/* D01-W08 Content performance learning → generic (what to double down on next week). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, need, profileHasSubstance, rows, siteText, type Skill } from "./types";

export const contentPerformance: Skill = {
  id: "D01-W08",
  routineId: "D01-W08",
  name: "Content performance learning",
  kind: "generic",
  maxItems: 4,
  purpose: "A weekly readout of what to double down on, drop or test — as data, before any story about why",
  inputs: ["Instagram insights (when connected)", "LinkedIn posts (when connected)", "GA4 social report (when connected)", "a post the founder pastes", "site profile (what I'd measure, when there are no posts)"],
  file: {
    goal: "Four learnings: what to double down on, drop or test next week",
    owns: ["the weekly learning note", "double-down vs drop vs test labels"],
    reads: ["Instagram insights", "LinkedIn posts", "GA4 social", "a pasted source post", "site profile when no posts exist"],
    decides: ["which format and topic earned the keep", "what to drop", "what to test next"],
    writes: ["a generic readout of up to four learnings"],
    never: ["invent reach, plays, saves or conversions", "publish", "tell a story the numbers don't support"],
    apply: "Drafts. I don't publish next week's plan — you do, once we agree what to double down on.",
    examples: [
      { when: "no social connected, a scanned site", does: "four 'what I'd measure' items (saves, follows, comments, social sessions), no invented reach" },
      { when: "Instagram insights with saves and a GA4 social row", does: "double down on the format that saved; drop the one that didn't; numbers from those rows only" },
    ],
  },
  minimum: minimum("recent posts with reach and saves — or a pasted post, or the site profile so I can say what I'd measure", [], ["source_post"], ["instagram", "linkedin", "ga4"]),
  domain: "content",
  prompt: `CRAFT — content performance:
- I write at most four learnings. Body is the readout in one short paragraph: what moved, over which window, from which source. Then the items. I state what the data shows before I interpret it. An interpretation that cannot be wrong is a story — I don't write those.
- Each item follows LEARNING / EVIDENCE / CONFIDENCE / ACTION. LEARNING is one sentence. EVIDENCE names the number and the source (a row or the pasted post). CONFIDENCE is high / medium / low from data volume, never from how much I like the story. ACTION is double down, drop, or test — one move.
- With ig / li / ga rows I only cite reach, plays, saves, follows, impressions, reactions, comments, sessions, conversions when that field is on the row. No invented reach. Rank by saves and follows over vanity views when both exist.
- Without posts I do not fake a readout. I use the profile (and a pasted source_post if there is one) to say what I would measure next week and why those metrics, not those numbers. Every item's evidence is "not yet measured". I never fill in a reach figure.
- Where a line needs a fact I don't have, I write [needs a real fact: what would make this true]. Facts only from the material. I don't publish. Live mode stays off.
- meta per item: { move: "double_down" | "drop" | "test", format: "…", topic: "…", reach: <from the row or null>, confidence: "high" | "medium" | "low" }.`,
  outputSpec: `{"kind":"generic","title":"What to double down on this week","body":"the readout: what moved, what to drop, or what I'd measure if I had no posts","items":[{"title":"<learning>","body":"<EVIDENCE · CONFIDENCE · ACTION>","meta":{"move":"double_down","format":"…","topic":"…","reach":null,"confidence":"low"}}],"evidence":[{"source":"read:ig|read:li|read:ga|input:source_post|site_profile","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const ig = rows(ctx, "ig").length;
    const li = rows(ctx, "li").length;
    const ga = rows(ctx, "ga").length;
    if (ig) using.push(`${ig} Instagram insights`);
    if (li) using.push(`${li} LinkedIn posts`);
    if (ga) using.push(`${ga} GA4 social rows`);
    if (ctx.inputs.source_post) using.push("the post you pasted");
    const base = knowsTheBusiness(ctx);
    using.push(...base.using);
    if (ctx.inputs.about_the_business) using.push("your note");
    if (!ig && !li && !ga && !ctx.inputs.source_post && profileHasSubstance(ctx.profile) && siteText(ctx.profile).length) using.push("your site's product text");
    if (ig || li || ga || ctx.inputs.source_post || base.ok || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [need.input("source_post", "paste a recent post you want a readout on — or connect Instagram, LinkedIn or GA4 and I'll read the last 28 days"), NEED_BUSINESS] };
  },
};
