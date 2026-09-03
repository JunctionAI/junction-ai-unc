/* D03-W06 Competitor gap watch → content_gap (new competitor pages vs your rankings). */
import { knowsTheBusiness, minimum, need, rows, type Skill } from "./types";

export const competitorWatch: Skill = {
  id: "D03-W06",
  routineId: "D03-W06",
  name: "Competitor gap watch",
  kind: "content_gap",
  maxItems: 8,
  purpose: "New or changed competitor pages that threaten a ranking this site holds — hypotheses until a crawl proves them",
  inputs: ["competitor domains (vars.competitorDomains or pasted)", "competitor crawl (research read, when available)", "Search Console queries (when connected)", "site profile (category, products, competitors mentioned)"],
  file: {
    goal: "Competitor moves ranked by the ranking they threaten, with a counter-move each",
    owns: ["the threat list", "the counter-move per new competitor page"],
    reads: ["competitor crawl when available (research, no connector)", "Search Console when connected", "competitor domains (vars or pasted)", "site profile"],
    decides: ["which new pages actually threaten a query you care about", "the counter-move"],
    writes: ["a content_gap artifact"],
    never: ["invent competitor traffic", "treat a hypothesis as a crawl finding"],
    apply: "Drafts. I don't write the counter-page until you pick a threat.",
    examples: [
      { when: "site profile and competitor domains, no crawl", does: "hypothesis list of pages those domains would publish, every item labelled hypothesis" },
      { when: "crawl shows competitor-a.com/how-to-choose published this week", does: "that page first, the query it targets, the counter-move" },
    ],
  },
  minimum: minimum("the site profile and competitor domains (set on the routine or pasted); crawls make the threats real", [], ["competitors"], ["search_console"]),
  domain: "seo",
  prompt: `CRAFT — competitor gap watch:
- Each item is one competitor page (or the page you hypothesise they will publish). Title = their working H1 or URL. Body = which of your queries or pages it threatens, why now, and the counter-move (match the angle, add the comparison, retitle the owning page).
- Without crawl rows this is a HYPOTHESIS list: say so in the body and mark every item meta.status "hypothesis". With crawl rows, cite the competitor URL and mark "measured". Search Console rows, when present, name the query and position that is at risk — never invent a position or a traffic number for them or for you.
- Rank by how close the page is to a buying query you already care about, not by guessed volume.
- meta per item: { competitor: "…", url: "<from the crawl or null>", status: "hypothesis" | "measured", target_query: "…", move: "…" }.`,
  outputSpec: `{"kind":"content_gap","title":"<n> competitor moves vs <site name>","body":"what you watched, what is measured vs hypothesized, how you ranked the threats","items":[{"title":"<competitor H1 or URL>","body":"<who · which query it threatens · the counter-move>","meta":{"competitor":"…","url":null,"status":"hypothesis","target_query":"…","move":"…"}}],"evidence":[{"source":"site_profile|read:competitors|read:gsc|input:competitors|vars","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const competitors = rows(ctx, "competitors").length;
    if (competitors) using.push(`${competitors} competitor pages`);
    if (rows(ctx, "gsc").length) using.push("Search Console queries");
    if (ctx.vars.competitorDomains) using.push("competitor domains");
    if (ctx.inputs.competitors) using.push("the competitors you named");
    if (competitors || ctx.inputs.competitors || (base.ok && ctx.vars.competitorDomains)) return { ok: true, using };
    return { ok: false, needs: [need.input("competitors", "name the competitor domains you want watched (or set them on the routine)")] };
  },
};
