/* D05-W06 Review request timing → generic (one timing proposal for the review request). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const reviewTiming: Skill = {
  id: "D05-W06",
  routineId: "D05-W06",
  name: "Review request timing",
  kind: "generic",
  maxItems: 1,
  purpose: "When to ask for the review — timed to when customers actually leave them, suppressed for open tickets",
  inputs: ["orders with delivery dates (Shopify — required)", "review timing metrics (Klaviyo, when connected)", "the current Review Request flow (Klaviyo, when connected)", "open tickets (Gorgias, when connected)", "a pasted flow_note"],
  file: {
    goal: "One timing proposal for the review-request flow",
    owns: ["the timing proposal", "the open-ticket suppression rule"],
    reads: ["Shopify orders (required)", "Klaviyo review metrics and Review Request flow when connected", "open tickets when connected", "a pasted flow_note"],
    decides: ["the delay in days after delivery", "who to suppress"],
    writes: ["a generic artifact of one proposal"],
    never: ["invent a peak_day or a review count", "send the request", "run for a non-store"],
    apply: "Drafts only. Any future timing change or send needs a separate exact run-level approval gate.",
    examples: [
      { when: "reviews metrics include peak_day 9 and the flow asks on day 3", does: "propose day 9, citing 9, and keep open-ticket customers suppressed" },
      { when: "orders exist but no review metrics", does: "a starting-hypothesis delay from delivery windows, labelled as not-yet-measured, no invented peak_day" },
    ],
  },
  minimum: minimum("a Shopify store with deliveries to time the review request from — this routine is for stores", ["shopify", "klaviyo"], [], ["gorgias"]),
  domain: "email",
  prompt: `CRAFT — review request timing:
- One item = the timing proposal for the Review Request flow. Title names the proposed day after delivery. Body: when customers actually leave reviews, what the flow does today, the change (or why to keep it), and that anyone with an open support ticket stays suppressed.
- If reviews metrics include peak_day, cite it and propose that day (or keep the current delay if it already matches). If peak_day is missing, say the timing is a starting hypothesis from the order/delivery rows — never invent a peak_day, a review count or a "reviews lift X%" figure.
- Cite the current delay only if it is on the flow rows (delay_days). Cite ticket suppression only from ticket rows; never invent how many people would be suppressed.
- No email copy dump unless the founder asked; this artifact is the timing decision, not a new request email. One primary recommendation.
- meta: { current_delay: <from flow or null>, proposed_delay: <from peak_day or hypothesis>, peak_day: <from metrics or null>, suppress_open_tickets: true }.`,
  outputSpec: `{"kind":"generic","title":"Review request: day <n> after delivery","body":"the measured peak (only if peak_day is in the metrics), the current delay, the proposed change, and the open-ticket suppress","items":[{"title":"Move to day <n> after delivery (or keep day <n>)","body":"<why, who is suppressed, what 'worked' looks like — a behaviour, not an invented review count>","meta":{"current_delay":null,"proposed_delay":null,"peak_day":null,"suppress_open_tickets":true}}],"evidence":[{"source":"read:orders|read:reviews|read:flow|read:tickets|site_profile|memory|input:flow_note","ref":"…"}]}`,
  check(ctx) {
    if (ctx.inputs.flow_note) {
      const using = ["the review-timing note you pasted"];
      const orders = rows(ctx, "orders").length;
      if (orders) using.push(`${orders} orders`);
      if (readAnswered(ctx, "reviews")) using.push("review timing");
      if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
      const tickets = rows(ctx, "tickets").length;
      if (tickets) using.push(`${tickets} open tickets`);
      return { ok: true, using };
    }
    if (!readAnswered(ctx, "orders")) {
      return { ok: false, needs: [need.platform("shopify", "deliveries are the material — this routine only applies to a store")] };
    }
    const using: string[] = [];
    const orders = rows(ctx, "orders").length;
    if (orders) using.push(`${orders} orders`);
    else using.push("the Shopify store");
    if (readAnswered(ctx, "reviews")) using.push("review timing");
    if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
    const tickets = rows(ctx, "tickets").length;
    if (tickets) using.push(`${tickets} open tickets`);
    return { ok: true, using };
  },
};
