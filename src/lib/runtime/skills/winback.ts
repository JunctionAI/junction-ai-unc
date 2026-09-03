/* D05-W04 Winback campaign prep → email (the campaign messages, drafted). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const winback: Skill = {
  id: "D05-W04",
  routineId: "D05-W04",
  name: "Winback campaign prep",
  kind: "email",
  maxItems: 3,
  purpose: "The winback campaign emails for customers who have not ordered in a while — drafted, never scheduled",
  inputs: ["lapsed customers (Shopify — required)", "past winback campaigns (Klaviyo, when connected)", "site profile (voice, products)", "a winback note from the founder when the lapsed list is empty"],
  file: {
    goal: "Three winback emails grounded in this store's lapsed customers",
    owns: ["the three-message email artifact", "the offer rule (only if memories allow)"],
    reads: ["Shopify lapsed customers (required)", "past Klaviyo winback campaigns when connected", "a pasted winback_note"],
    decides: ["the angle of each send (missed you / what's new / last word)", "whether an offer is allowed"],
    writes: ["an email artifact of three messages"],
    never: ["invent a discount or a % off", "send or schedule the campaign", "run for a non-store"],
    apply: "Drafts. Klaviyo send stays yours until we graduate this routine.",
    examples: [
      { when: "80 customers last ordered Marine Collagen 4 months ago", does: "name that product in email 2; no invented % off unless memories allow a discount" },
      { when: "Shopify returns 0 lapsed and the founder pastes a winback_note", does: "draft the three from the note and the products, still no invented offer" },
    ],
  },
  minimum: minimum("a Shopify store with lapsed customers — this routine is for stores", ["shopify"], [], ["klaviyo"]),
  domain: "email",
  prompt: `CRAFT — winback campaign:
- Three items = the three messages: (1) "we've missed you" — acknowledge the absence without blame, no discount; (2) about a week later — what's new (arrivals, best-sellers, a true reason to return from the products or the lapsed rows); (3) about two weeks later — the last word. A discount belongs only here, and ONLY if the memories allow discounts; never invent a code or a percentage. If they don't allow it, give a real non-discount reason (stock, season, a perk that is true).
- Each item: subject (≤ 45 chars) + preview text + body 80–140 words in the brand's voice, one link placeholder [shop link], one CTA. Give an easy preference-update path so people can lower frequency instead of leaving.
- Ground it in the lapsed rows: name products and recency only from those rows. Cite the lapsed count only as the number of rows you were given. Never invent reactivation rates, send counts or revenue.
- When past winback campaign rows exist, don't reuse a subject that already went out; don't invent their numbers — cite sends/revenue only if they are on the row.
- meta per item: { delay: "0d" | "7d" | "14d", subject: "…", preview: "…", offer: false }.`,
  outputSpec: `{"kind":"email","title":"Winback campaign: 3 messages","body":"who the lapsed customers are (count from the rows), the throughline of the three, and whether an offer is allowed (only from memories)","items":[{"title":"<delay>: <subject>","body":"<preview + body, markdown>","meta":{"delay":"…","subject":"…","preview":"…","offer":false}}],"evidence":[{"source":"read:lapsed|read:history|site_profile|memory|input:winback_note","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "lapsed")) {
      return { ok: false, needs: [need.platform("shopify", "lapsed customers are the material — this routine only applies to a store")] };
    }
    const n = rows(ctx, "lapsed").length;
    if (n >= 1) {
      const using = [`${n} lapsed customers`];
      if (rows(ctx, "history").length) using.push("past winback campaigns");
      if (ctx.inputs.winback_note) using.push("the winback note you pasted");
      return { ok: true, using };
    }
    if (ctx.inputs.winback_note) {
      const using = ["the winback note you pasted"];
      if (rows(ctx, "history").length) using.push("past winback campaigns");
      return { ok: true, using };
    }
    return {
      ok: false,
      needs: [need.input("winback_note", "fewer than 50 lapsed customers — tell me if you'd still like the campaign drafted")],
      note: "Fewer than 50 lapsed — not worth a campaign yet",
    };
  },
};
