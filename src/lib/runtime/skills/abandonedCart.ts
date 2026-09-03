/* D05-W02 Abandoned cart recovery → email (the recovery flow's messages, drafted). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const abandonedCart: Skill = {
  id: "D05-W02",
  routineId: "D05-W02",
  name: "Abandoned cart recovery",
  kind: "email",
  maxItems: 3,
  purpose: "The abandoned-cart recovery emails, rewritten from what people actually leave in their carts",
  inputs: ["abandoned checkouts (Shopify — required)", "the current Abandoned Cart flow and its numbers (Klaviyo, when connected)", "site profile (voice, products)"],
  file: {
    goal: "Three recovery emails grounded in this week's abandoned carts",
    owns: ["the three-message email artifact"],
    reads: ["Shopify abandoned checkouts (required)", "Klaviyo flow numbers when connected", "site voice"],
    decides: ["the angle of each delay (1h / 24h / 72h)", "which abandoned products to name"],
    writes: ["an email artifact of three messages"],
    never: ["invent a discount code", "send the flow", "run for a non-store"],
    apply: "Drafts. Klaviyo send stays yours until we graduate this routine.",
    examples: [
      { when: "12 checkouts left Marine Collagen", does: "name that product in the 1h reminder; 24h handles shipping; 72h a true reason, no invented % off" },
    ],
  },
  minimum: minimum("a Shopify store with abandoned checkouts this week — this routine is for stores", ["shopify"], [], ["klaviyo"]),
  domain: "email",
  prompt: `CRAFT — cart recovery emails:
- Three items = the three messages of the flow: (1) 1 hour: the reminder (helpful, no discount), (2) 24 hours: the objection-handler (shipping, returns, the product's why — from the profile), (3) 72 hours: the last word (a reason to decide now that is true — stock, season, a real perk; NOT an invented discount).
- Each item: subject (≤ 45 chars) + preview text + body 80–140 words in the brand's voice, one link placeholder [cart link], one CTA.
- Ground it in the carts read: name the products that get abandoned most (from the rows) and speak to them. Cite the abandoned value only if it is in the read's metrics.
- Never invent a discount code or a percentage. If the founder allows discounts it will be in the memories; otherwise don't.
- meta per item: { delay: "1h" | "24h" | "72h", subject: "…", preview: "…" }.`,
  outputSpec: `{"kind":"email","title":"Abandoned cart flow: 3 messages","body":"what the carts show (top products, count, value if measured) and the angle of each message","items":[{"title":"<delay>: <subject>","body":"<preview + body, markdown>","meta":{"delay":"…","subject":"…","preview":"…"}}],"evidence":[{"source":"read:checkouts|read:perf|site_profile|memory","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "checkouts")) return { ok: false, needs: [need.platform("shopify", "abandoned checkouts are the material — this routine only applies to a store")] };
    const carts = rows(ctx, "checkouts").length;
    if (!carts) return { ok: false, needs: [need.input("cart_note", "no abandoned checkouts in the last 7 days — tell me if you'd still like the flow drafted from your products")], note: "Nothing to recover this week." };
    const using = [`${carts} abandoned checkouts`];
    if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
    if (readAnswered(ctx, "perf")) using.push("flow numbers");
    return { ok: true, using };
  },
};
