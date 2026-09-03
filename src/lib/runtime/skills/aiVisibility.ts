/* D03-W03 AI search visibility → content_gap (buyer prompts where assistants name you or don't). */
import { knowsTheBusiness, minimum, need, rows, type Skill } from "./types";

export const aiVisibility: Skill = {
  id: "D03-W03",
  routineId: "D03-W03",
  name: "AI search visibility",
  kind: "content_gap",
  maxItems: 8,
  purpose: "Which buying prompts ChatGPT, Perplexity and Gemini answer with this business — and the page fixes that would earn a citation",
  inputs: ["buyer prompts (vars.buyerPrompts or pasted)", "LLM search tests when a research read exists (no connector)", "Shopify pages when connected", "site profile (entity, products, category)"],
  file: {
    goal: "The buying prompts assistants should name you for, and the page fix per gap",
    owns: ["the prompt-gap list", "the page brief per unmentioned prompt"],
    reads: ["buyer prompts (vars or pasted)", "LLM search rows when a research read exists — no connector", "Shopify pages when connected", "site profile"],
    decides: ["which prompts are the buying journey", "which page should earn the citation"],
    writes: ["a content_gap artifact"],
    never: ["invent mentioned_pct", "claim a prompt was tested when no LLM rows exist"],
    apply: "Drafts. I don't publish the page fixes until you pick one.",
    examples: [
      { when: "site profile and buyer prompts, no LLM rows", does: "gap briefs from those prompts, every item labelled not yet tested in ChatGPT/Perplexity/Gemini" },
      { when: "LLM rows show Perplexity citing a competitor for 'best marine collagen nz'", does: "that prompt first, status measured, the page that should own the citation" },
    ],
  },
  minimum: minimum("buyer prompts to test (set on the routine or pasted) plus what you sell; LLM search rows make it measured", [], ["buyer_prompts"], ["shopify"]),
  domain: "seo",
  prompt: `CRAFT — AI search visibility:
- Each item is one buying prompt the business should be named for. Title = the prompt in the buyer's words. Body = which assistant(s), whether this business was mentioned or cited (only from LLM rows), who else was named, the page that should own the answer (an existing product/FAQ/guide page when you can name one), and the one structural move (question-shaped H2, FAQ block, entity consistency, llms.txt, specific claim).
- Without LLM search rows this is NOT a measurement: label every item "not yet tested in ChatGPT/Perplexity/Gemini" and mark meta.status "not_yet_tested". With rows, rank real misses first and mark them "measured". Never write a mentioned_pct, mention rate, or engine share unless that number is in the LLM search material.
- Rank by buying proximity, not by guessed volume. No traffic or ranking numbers.
- meta per item: { engine: "chatgpt" | "perplexity" | "gemini" | "untested", mentioned: true | false | null, status: "not_yet_tested" | "measured", target_page: "…", move: "…" }.`,
  outputSpec: `{"kind":"content_gap","title":"<n> AI-search gaps on <site name>","body":"which prompts you tested (or could not yet), what the site already covers, how you ranked — no mention rate unless it is in the LLM rows","items":[{"title":"<buyer prompt>","body":"<engine · mentioned? · owning page · the move>","meta":{"engine":"…","mentioned":null,"status":"not_yet_tested","target_page":"…","move":"…"}}],"evidence":[{"source":"site_profile|read:llm|read:pages|input:buyer_prompts|vars","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const llm = rows(ctx, "llm").length;
    if (llm) using.push(`${llm} LLM prompt tests`);
    if (rows(ctx, "pages").length) using.push("site pages");
    if (ctx.vars.buyerPrompts) using.push("buyer prompts");
    if (ctx.inputs.buyer_prompts) using.push("the buyer prompts you pasted");
    if (llm || ctx.inputs.buyer_prompts || (base.ok && ctx.vars.buyerPrompts)) return { ok: true, using };
    return { ok: false, needs: [need.input("buyer_prompts", "paste the buying prompts you want tested in ChatGPT, Perplexity and Gemini (or set them on the routine)")] };
  },
};
