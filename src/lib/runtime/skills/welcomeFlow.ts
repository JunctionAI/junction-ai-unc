/* D05-W01 Welcome flow tuning → email (the replacement message for the weakest step). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const welcomeFlow: Skill = {
  id: "D05-W01",
  routineId: "D05-W01",
  name: "Welcome flow tuning",
  kind: "email",
  maxItems: 1,
  purpose: "The replacement welcome-flow message, rewritten from the weakest step's numbers and the store's voice",
  inputs: ["the current Welcome Series and its per-message numbers (Klaviyo — required)", "first orders (Shopify, when connected)", "site profile (voice, products)", "the current welcome copy pasted by the founder"],
  file: {
    goal: "One replacement welcome message for the weakest step",
    owns: ["the replacement email artifact"],
    reads: ["Klaviyo Welcome Series (required)", "per-message flow numbers when present", "Shopify first orders when connected", "a pasted flow_note"],
    decides: ["which step is weakest (only from perf metrics)", "the angle of the replacement"],
    writes: ["an email artifact of one message"],
    never: ["invent a CTOR, a send count or a discount code", "send the flow", "run for a non-store"],
    apply: "Drafts. Klaviyo send stays yours until we graduate this routine.",
    examples: [
      { when: "perf metrics name message 2 at 7.06% CTOR", does: "one replacement for that step, citing 7.06%, no invented send count" },
      { when: "founder pastes the current welcome emails, no Klaviyo yet", does: "one replacement from the pasted copy and the store's products" },
    ],
  },
  minimum: minimum("a Klaviyo Welcome Series and a Shopify store — this routine is for stores", ["klaviyo", "shopify"], [], []),
  domain: "email",
  prompt: `CRAFT — welcome flow replacement:
- One item = the replacement message for the weakest welcome step. If perf metrics include weakest_ctor_pct (and weakest_message_position / weakest_message_id), name that step and cite those figures; if they are missing, say you don't have CTOR yet and write a hypothesis for the proof/education email, not a ranked claim.
- Never invent a CTOR, an open rate, a click rate or a send count. Never invent a discount code or a percentage. If the founder allows a welcome incentive it will be in the memories; otherwise don't.
- Subject ≤ 45 characters, preview text that extends the hook (does not repeat it), body 80–140 words in the brand's voice. One primary CTA. Anyone who has already purchased should exit — say so in the body as a filter note, not as copy.
- Ground it in the current flow rows when you have them (keep the step's job: welcome / story / best-seller / proof / how-to / nudge). Name products from the profile or the first-order rows; don't invent bestsellers.
- meta: { position: <from metrics or null>, message_id: "<from metrics or null>", subject: "…", preview: "…" }.`,
  outputSpec: `{"kind":"email","title":"Welcome flow: replacement for step <n or weakest>","body":"which step you are replacing and why (CTOR only if measured) plus the angle of the new message","items":[{"title":"<subject>","body":"<preview + body, markdown>","meta":{"position":null,"message_id":null,"subject":"…","preview":"…"}}],"evidence":[{"source":"read:flow|read:perf|read:orders|site_profile|memory|input:flow_note","ref":"…"}]}`,
  check(ctx) {
    if (ctx.inputs.flow_note) {
      const using = ["the welcome copy you pasted"];
      if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
      if (readAnswered(ctx, "perf")) using.push("flow numbers");
      const orders = rows(ctx, "orders").length;
      if (orders) using.push(`${orders} first orders`);
      return { ok: true, using };
    }
    if (!readAnswered(ctx, "flow") && !readAnswered(ctx, "perf")) {
      return { ok: false, needs: [need.platform("klaviyo", "the Welcome Series is the material — this routine only applies to a store with Klaviyo")] };
    }
    const using: string[] = [];
    if (rows(ctx, "flow").length) using.push("the current Klaviyo flow");
    if (readAnswered(ctx, "perf")) using.push("flow numbers");
    const orders = rows(ctx, "orders").length;
    if (orders) using.push(`${orders} first orders`);
    if (!using.length) using.push("Klaviyo");
    return { ok: true, using };
  },
};
