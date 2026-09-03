/* D01-W03 Customer-question mining → question_list (recurring questions → content ideas). */
import { minimum, need, profileHasSubstance, rows, siteText, type Skill } from "./types";

export const customerQuestions: Skill = {
  id: "D01-W03",
  routineId: "D01-W03",
  name: "Customer-question mining",
  kind: "question_list",
  maxItems: 10,
  purpose: "The questions customers keep asking, ranked, each turned into a content idea with a format",
  inputs: ["support tickets (Gorgias, when connected)", "product reviews (Shopify, when connected)", "Instagram comments (when connected)", "the scanned site's FAQ and product text (fallback)", "a pasted batch of questions from the founder"],
  file: {
    goal: "The questions customers keep asking, each turned into one content idea",
    owns: ["the ranked question list", "the format suggestion per question"],
    reads: ["Gorgias tickets", "reviews", "comments", "site FAQ/product text as fallback", "a pasted batch"],
    decides: ["which questions are duplicates", "which format fits each one"],
    writes: ["a question_list artifact"],
    never: ["invent frequencies", "treat site-FAQ stand-ins as real tickets without saying so"],
    apply: "Drafts only. I graduate the ranking once you keep the same top questions two weeks running.",
    examples: [
      { when: "no support connector, a site with FAQ text", does: "list the questions the pages invite, labelled as not-yet-from-real-messages" },
      { when: "20 Gorgias tickets about shipping to AU", does: "one item, frequency 20, format FAQ page + a post" },
    ],
  },
  minimum: minimum("customer questions from support, reviews or comments — or the scanned site's FAQ/product text", [], ["customer_questions"], ["gorgias", "shopify", "instagram"]),
  domain: "content",
  prompt: `CRAFT — question mining:
- Group near-duplicate questions; one item per real question, ranked by how often it shows up (when you have counts) or how central it is to buying (when you only have site text).
- When the material is site/product text rather than real tickets, say so in the body ("from your site's product pages, not yet from real customer messages") and frame each item as "the question this page invites".
- Each item: the question in the customer's words as title; body = why it matters (objection, confusion, buying trigger) + one content idea + the format that fits (short video, carousel, FAQ page, email, product page edit).
- No invented frequencies. If you have ticket counts, cite them; if not, no numbers.
- meta per item: { frequency: <count or null>, format: "…", stage: "awareness" | "consideration" | "purchase" | "post_purchase" }.`,
  outputSpec: `{"kind":"question_list","title":"Top <n> customer questions → content ideas","body":"one short paragraph: where the questions came from and what pattern you see","items":[{"title":"<the question>","body":"<why it matters + the idea + the format>","meta":{"frequency":null,"format":"…","stage":"…"}}],"evidence":[{"source":"read:tickets|read:reviews|read:comments|site_profile|input:customer_questions","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const t = rows(ctx, "tickets").length;
    const r = rows(ctx, "reviews").length;
    const c = rows(ctx, "comments").length;
    if (t) using.push(`${t} tickets`);
    if (r) using.push(`${r} reviews`);
    if (c) using.push(`${c} comments`);
    if (ctx.inputs.customer_questions) using.push("the questions you pasted");
    if (using.length) return { ok: true, using };
    if (profileHasSubstance(ctx.profile) && siteText(ctx.profile).length) return { ok: true, using: ["your site's product/FAQ text (no support connector yet)"] };
    return {
      ok: false,
      needs: [need.platform("gorgias", "real customer questions to mine"), need.input("customer_questions", "or paste the last 10–20 questions customers asked you")],
      note: "Your site scan doesn't have enough product or FAQ text to stand in.",
    };
  },
};
