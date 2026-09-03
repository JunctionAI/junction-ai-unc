/* D03-W02 Content gap analysis → content_gap (topics competitors cover that the site doesn't). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const contentGap: Skill = {
  id: "D03-W02",
  routineId: "D03-W02",
  name: "Content gap analysis",
  kind: "content_gap",
  maxItems: 10,
  purpose: "The pages a business in this category is expected to have, compared with what the site has — one brief per gap",
  inputs: ["site profile (sections, products, category, competitors mentioned)", "Search Console queries (when connected)", "competitor crawl (research read, when available)"],
  file: {
    goal: "One brief per missing page a business in this category is expected to have",
    owns: ["the gap list", "the page brief per gap"],
    reads: ["site profile sections", "Search Console when connected", "competitor crawl when available"],
    decides: ["which expected pages are actually missing", "which gap is worth a brief first"],
    writes: ["a content_gap artifact"],
    never: ["invent competitor traffic", "claim a page exists that the profile didn't show"],
    apply: "Drafts. I don't write the missing page until you pick one.",
    examples: [
      { when: "a supplements store with no 'how to choose' page", does: "one gap brief for that page, grounded in the category norm" },
    ],
  },
  minimum: minimum("the site profile (its sections and category); competitor crawls sharpen it", [], ["about_the_business"], ["search_console"]),
  domain: "seo",
  prompt: `CRAFT — content gaps:
- Compare what the site covers (products, signals, sections in the profile) with the category norm: buying guides, comparisons, "how to choose", ingredient/material explainers, FAQs, use-case pages, local/region pages, trust pages (shipping, returns, sourcing).
- Each item = one gap: title is the page that should exist (a working H1), body = why it's a gap (what a buyer asks at that stage), what the page must contain (3–5 bullets), and the internal link it should earn from.
- Rank by buying proximity, not by volume. No traffic numbers unless they are in the Search Console material.
- When competitor crawl rows exist, cite the competitor page that proves the norm; otherwise say the norm comes from the category, not a crawl.
- meta per item: { stage: "…", page_type: "guide" | "comparison" | "faq" | "use_case" | "trust" | "collection", proof: "competitor" | "category_norm" }.`,
  outputSpec: `{"kind":"content_gap","title":"<n> content gaps on <site name>","body":"what the site covers well, what the category expects, how you ranked","items":[{"title":"<working H1>","body":"<why · must contain · link from>","meta":{"stage":"…","page_type":"…","proof":"…"}}],"evidence":[{"source":"site_profile|read:competitors|read:own|read:gsc","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    if (rows(ctx, "competitors").length) using.push(`${rows(ctx, "competitors").length} competitor pages`);
    if (rows(ctx, "gsc").length) using.push("Search Console queries");
    if (base.ok || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
