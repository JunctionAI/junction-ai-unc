/* D02-W06 Creative test planner → generic (hooks × formats × offers matrix). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const testPlanner: Skill = {
  id: "D02-W06",
  routineId: "D02-W06",
  name: "Creative test planner",
  kind: "generic",
  maxItems: 8,
  purpose: "Next month's test matrix — hooks × formats × offers — untested cells ranked, no invented lift",
  inputs: ["ad insights with hook/format/offer when Meta is connected", "Instagram library (when connected)", "site profile (products, audience, voice) as the schema fallback"],
  file: {
    goal: "A hooks × formats × offers matrix with untested cells ranked for next month",
    owns: ["the test-matrix schema", "hypothesized vs measured labels"],
    reads: ["Meta ads when connected", "Instagram library when connected", "site profile"],
    decides: ["which cells are untested", "the order to fill them"],
    writes: ["a generic artifact of up to eight matrix cells"],
    never: ["invent lift %, CPA or spend", "publish a test", "spend"],
    apply: "Drafts. I keep the matrix you keep running; I don't publish tests from this list.",
    examples: [
      { when: "only a site profile", does: "a hypothesized matrix from products and voice, every cell status hypothesized, no lift %" },
      { when: "28 days of ads with hook/format/offer", does: "measured cells first from the rows; untested combinations ranked without invented lift" },
    ],
  },
  minimum: minimum("the site profile (hooks, formats, offers to test); Meta ads make the cells measured", [], ["about_the_business"], ["meta_ads", "instagram"]),
  domain: "paid",
  prompt: `CRAFT — creative test matrix:
- Build a hooks × formats × offers matrix. Items are cells (max 8), untested first. Title of each item is the cell: "<hook> × <format> × <offer>".
- Without ad rows this is a SCHEMA from the site profile (products, audience, voice): every meta.status is "hypothesized". Say so in the body. With ad rows, mark cells that already ran as "measured" and cite only the CPA/spend/CTR present on those rows.
- Rank untested cells by how different the concept is (product or use, proof type, person, offer) — not by a guessed lift. Never invent a lift %, ROAS, spend, frequency or CPA. Never write "expected +20%".
- Each body: the hypothesis in one line, the brief for the content engine (hook in the first three words, format, the offer as factually true), and what would make it measured (a Meta ad with that hook/format/offer).
- meta per item: { hook: "…", format: "…", offer: "…", status: "hypothesized" | "measured" }.`,
  outputSpec: `{"kind":"generic","title":"Test matrix: <n> cells to run next","body":"what is measured vs hypothesized, how you ranked the untested cells (no lift %)","items":[{"title":"<hook> × <format> × <offer>","body":"<hypothesis · brief · what would measure it>","meta":{"hook":"…","format":"…","offer":"…","status":"hypothesized"}}],"evidence":[{"source":"site_profile|read:ads|read:library","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const ads = rows(ctx, "ads").length;
    if (ads) using.push(`${ads} ads`);
    if (rows(ctx, "library").length) using.push("Instagram library");
    if (ctx.inputs.about_the_business) using.push("your note about the business");
    if (base.ok || ads || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
