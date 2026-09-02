/* D01-W01 Founder content engine → post_set (3 founder-voice posts). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const founderContent: Skill = {
  id: "D01-W01",
  routineId: "D01-W01",
  name: "Founder content engine",
  kind: "post_set",
  maxItems: 3,
  purpose: "Three founder-voice posts drafted from what customers actually ask and what the business stands for",
  inputs: ["site profile (products, audience, voice)", "memories about the business", "customer questions (Gorgias tickets, when connected)", "past posts that performed (LinkedIn, when connected)", "products (Shopify, when connected)"],
  minimum: minimum("a scanned site profile or three things I know about the business", [], ["about_the_business"], ["gorgias", "linkedin", "shopify"]),
  domain: "content",
  prompt: `CRAFT — founder posts:
- Three posts, each a different angle: (1) a customer question answered plainly, (2) a belief or a rule the founder runs the business by, (3) a behind-the-scenes specific (a product detail, a process, a trade-off).
- Written in the founder's first person, not Unc's. Sound like the business profile's voice and the founder's own phrases when you have them.
- Hook in the first line: a concrete claim, question or contrast — never "Excited to share".
- 60–160 words each. Short lines. One idea per post. End with a soft, specific prompt (a question the reader can answer), not a hashtag wall.
- Facts only from the material: products, audience, region, what customers asked. No invented customer stories, numbers, awards or quotes. Where a strong line needs a fact you don't have, write [needs a real fact: what would make this true].
- meta per item: { angle: "question" | "belief" | "behind_the_scenes", platform: "linkedin" | "instagram" | "x" }.`,
  outputSpec: `{"kind":"post_set","title":"3 founder posts: <theme in five words>","body":"one paragraph in Unc's voice: what these three posts do and where the material came from","items":[{"title":"<post hook line>","body":"<the full post, markdown>","meta":{"angle":"…","platform":"…"}}],"evidence":[{"source":"site_profile|memory|read:questions|read:products","ref":"<the line you used>"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    if (rows(ctx, "questions").length) using.push(`${rows(ctx, "questions").length} customer questions`);
    if (rows(ctx, "posts").length) using.push("past posts");
    if (rows(ctx, "products").length) using.push("products");
    if (ctx.inputs.about_the_business) using.push("your note about the business");
    if (base.ok || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
