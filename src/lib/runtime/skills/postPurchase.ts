/* D05-W05 Post-purchase education → email (one how-to message for the post-purchase flow). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const postPurchase: Skill = {
  id: "D05-W05",
  routineId: "D05-W05",
  name: "Post-purchase education",
  kind: "email",
  maxItems: 1,
  purpose: "The post-purchase how-to email, written from the questions people actually ask after they buy",
  inputs: ["recent orders (Shopify — required)", "how-to tickets (Gorgias, when connected)", "the current Post-Purchase flow (Klaviyo, when connected)", "site profile (products, how-to text)", "a pasted flow_note"],
  file: {
    goal: "One post-purchase education email answering a real how-to",
    owns: ["the education email artifact"],
    reads: ["Shopify orders (required)", "Gorgias how-to tickets when connected", "Klaviyo Post-Purchase flow when connected", "a pasted flow_note"],
    decides: ["which product question the flow should answer next", "the delay (day 3 after delivery)"],
    writes: ["an email artifact of one message"],
    never: ["invent a ticket count or a product-share %", "send the flow", "run for a non-store"],
    apply: "Drafts only. Any future Klaviyo change or send needs a separate exact run-level approval gate.",
    examples: [
      { when: "how-to tickets cluster on mixing Marine Collagen", does: "one day-3 email that answers that, citing the ticket count from the rows" },
      { when: "orders exist but no tickets", does: "one education email from the product pages, labelled as not-yet-from-tickets" },
    ],
  },
  minimum: minimum("a Shopify store with recent orders — this routine is for stores", ["shopify", "klaviyo"], [], ["gorgias"]),
  domain: "email",
  prompt: `CRAFT — post-purchase education:
- One item = the education message to add around day 3 after delivery. Job: how to use the product and get the result — reassurance and care, not a cross-sell and not a discount.
- Ground it in how-to tickets when those rows exist: name the product they ask about most and answer that question in the founder's voice. Cite a ticket count only as the number of ticket rows you were given; never invent a count or a "share %".
- With no tickets, say so in the body ("from your product pages, not yet from real how-to questions") and write from the order line-items and the profile. Don't invent FAQs.
- Subject ≤ 45 characters, preview text that extends the promise, body 80–140 words, one primary CTA (a how-to, a care tip, a link placeholder [how-to link]). If the current flow rows already cover that product, say so and write the tighter version, don't duplicate.
- meta: { delay: "after_delivery_day_3", product: "<from tickets or orders or null>", subject: "…", preview: "…" }.`,
  outputSpec: `{"kind":"email","title":"Post-purchase education: <product>","body":"which how-to you are answering (ticket count only if measured) and where it sits in the flow","items":[{"title":"<subject>","body":"<preview + body, markdown>","meta":{"delay":"after_delivery_day_3","product":null,"subject":"…","preview":"…"}}],"evidence":[{"source":"read:orders|read:tickets|read:flow|site_profile|memory|input:flow_note","ref":"…"}]}`,
  check(ctx) {
    if (ctx.inputs.flow_note) {
      const using = ["the post-purchase note you pasted"];
      const orders = rows(ctx, "orders").length;
      if (orders) using.push(`${orders} orders`);
      const tickets = rows(ctx, "tickets").length;
      if (tickets) using.push(`${tickets} how-to tickets`);
      if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
      return { ok: true, using };
    }
    if (!readAnswered(ctx, "orders")) {
      return { ok: false, needs: [need.platform("shopify", "recent orders are the material — this routine only applies to a store")] };
    }
    const using: string[] = [];
    const orders = rows(ctx, "orders").length;
    if (orders) using.push(`${orders} orders`);
    else using.push("the Shopify store");
    const tickets = rows(ctx, "tickets").length;
    if (tickets) using.push(`${tickets} how-to tickets`);
    if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
    return { ok: true, using };
  },
};
