/* D03-W04 On-page SEO fixes → generic (one title+description rewrite; applied only after approval). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const onPageSeo: Skill = {
  id: "D03-W04",
  routineId: "D03-W04",
  name: "On-page SEO fixes",
  kind: "generic",
  maxItems: 1,
  purpose: "The one Shopify page whose title and meta description most need a rewrite this week — drafted, never applied without approval",
  inputs: ["Shopify pages (title, meta title, meta description, h1 — required)", "Search Console page impressions and CTR (when connected)"],
  file: {
    goal: "One drafted title and meta description for the weakest Shopify page",
    owns: ["the proposed title and description", "which page is worth fixing this week"],
    reads: ["Shopify pages (required)", "Search Console page queries when connected"],
    decides: ["which page to fix (missing meta first, then weakest CTR among rows with impressions)", "the new copy"],
    writes: ["a generic artifact with the current vs proposed meta"],
    never: ["invent impression counts", "apply the Shopify write without approval"],
    apply: "Drafts the new title and description. Applying the Shopify write stays yours until you approve.",
    examples: [
      { when: "a collection page has no meta description", does: "draft title + description for that handle; impressions only if Search Console has them" },
      { when: "GSC shows 400 impressions at 0.4% CTR on /acc-physio", does: "that page, current vs proposed, the impression figure from the row" },
    ],
  },
  minimum: minimum("a Shopify store whose pages I can read; Search Console impressions rank which fix is worth it", ["shopify"], [], ["search_console"]),
  domain: "seo",
  prompt: `CRAFT — on-page SEO fix:
- One item, one page. Prefer a page whose meta title or description is missing in the Shopify rows; otherwise the page with the weakest CTR among Search Console rows that actually have impressions. Name the handle. If several are missing meta and there are no impression figures, pick the one whose H1/title is thinnest — say that is the rule, not a traffic ranking.
- Body: **Current** title and description (verbatim from the row, or "missing"), **Proposed** title (≤ 60 characters, primary phrase in the H1/title) and description (≤ 155 characters, one benefit, no clickbait), **Why this page** (missing meta, or the CTR/impressions from the Search Console row).
- No impression, click, CTR or position numbers unless they are in the Search Console material. Never estimate them. Never claim the write has been applied.
- meta: { page_id: "<from the row>", handle: "…", new_title: "…", new_description: "…", impressions: <from GSC or null>, ctr: <from GSC or null> }.`,
  outputSpec: `{"kind":"generic","title":"On-page SEO: rewrite /<handle>","body":"which page, why this one, current vs proposed — impressions only if Search Console had them","items":[{"title":"/<handle>","body":"<markdown: current · proposed · why>","meta":{"page_id":"…","handle":"…","new_title":"…","new_description":"…","impressions":null,"ctr":null}}],"evidence":[{"source":"read:pages|read:gsc","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "pages")) return { ok: false, needs: [need.platform("shopify", "page titles and descriptions live on Shopify — connect it so I can draft the rewrite")] };
    const pages = rows(ctx, "pages").length;
    if (!pages) return { ok: false, needs: [need.platform("shopify", "I need at least one Shopify page to rewrite a title and description on")] };
    const using = [`${pages} Shopify pages`];
    const gsc = rows(ctx, "gsc").length;
    if (gsc) using.push(`${gsc} Search Console pages`);
    return { ok: true, using };
  },
};
