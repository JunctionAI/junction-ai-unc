/* D03-W01 Keyword opportunity scan → keyword_list (hypotheses to validate in Search Console). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const keywordScan: Skill = {
  id: "D03-W01",
  routineId: "D03-W01",
  name: "Keyword opportunity scan",
  kind: "keyword_list",
  maxItems: 15,
  purpose: "Searches the business can plausibly win with pages it already has — a hypothesis list to validate in Search Console",
  inputs: ["site profile (category, products, region)", "Search Console striking-distance queries (when connected)", "site pages (Shopify, when connected)"],
  minimum: minimum("the website's category and products (from the scan); Search Console makes it real", [], ["about_the_business"], ["search_console", "shopify"]),
  domain: "seo",
  prompt: `CRAFT — keyword opportunities:
- Without Search Console data this is a HYPOTHESIS list: say so in the title ("to validate in Search Console") and in every item's meta.status. With Search Console rows, rank the real striking-distance queries (position 8–30) first and mark them "measured".
- Each item: the search phrase as title (long-tail, buyer language, region-aware — e.g. "… nz"); body = intent (informational / commercial / transactional), the page on the site that should own it (an existing product/collection/FAQ page when you can name one, else "new page"), and the one move (retitle, add an FAQ block, write a guide, add a comparison).
- No search volumes, positions or CTRs unless they are in the Search Console material. Never estimate them.
- Group by theme in the body (3–5 themes).
- meta per item: { intent: "…", target_page: "…", move: "…", status: "hypothesis" | "measured" }.`,
  outputSpec: `{"kind":"keyword_list","title":"<n> keyword opportunities to validate in Search Console","body":"themes and how to validate them (Search Console → Performance → filter query)","items":[{"title":"<search phrase>","body":"<intent · owning page · the move>","meta":{"intent":"…","target_page":"…","move":"…","status":"hypothesis"}}],"evidence":[{"source":"site_profile|read:gsc|read:pages","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const gsc = rows(ctx, "gsc").length;
    if (gsc) using.push(`${gsc} Search Console queries`);
    if (rows(ctx, "pages").length) using.push("site pages");
    if (ctx.vars.website) using.push(`website ${String(ctx.vars.website)}`);
    if (base.ok || gsc || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
