/* D05-W07 Campaign calendar prep → calendar (the next six weeks, one slot per week). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, rows, type Skill } from "./types";

export const campaignCalendar: Skill = {
  id: "D05-W07",
  routineId: "D05-W07",
  name: "Campaign calendar prep",
  kind: "calendar",
  maxItems: 6,
  purpose: "The next six weeks of campaigns, sequenced from the goal, the plan and the business's own seasonality",
  inputs: ["the goal and its deadline", "the agreed plan's phases", "site profile (products, audience, region)", "order history by week (Shopify, when connected)", "past campaigns (Klaviyo, when connected)", "upcoming launches (Shopify, when connected)", "memories: upcoming events, constraints"],
  minimum: minimum("the goal + the plan + what the business sells; order history makes the timing real", [], ["about_the_business"], ["shopify", "klaviyo"]),
  domain: "email",
  prompt: `CRAFT — campaign calendar:
- Six items = six weeks, starting the Monday after today. Title = "Week of <date>: <theme>". Body = the campaign's job in the plan (which phase, which goal lever), the channel(s), a working subject line, the send day, and what "worked" looks like (a behaviour, not an invented number).
- Sequence around real anchors only: events and constraints in the memories, launches in the reads, seasonality visible in the order history rows. With no history, say the timing is a starting hypothesis.
- Respect send-fatigue: at most two sends a week; no discount campaign unless the memories allow discounts.
- meta per item: { week_start: "YYYY-MM-DD", channel: "email" | "sms" | "email+sms", theme: "…", phase: "…" }.`,
  outputSpec: `{"kind":"calendar","title":"Next 6 weeks of campaigns","body":"the throughline (goal → phase → these six), the anchors you used, what you're unsure of","items":[{"title":"Week of …: …","body":"…","meta":{"week_start":"…","channel":"…","theme":"…","phase":"…"}}],"evidence":[{"source":"goal|plan|site_profile|memory|read:orders|read:campaigns|read:products","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    if (ctx.goal?.title) using.push(`goal “${ctx.goal.title}”`);
    if (ctx.plan?.length) using.push("the plan");
    if (rows(ctx, "orders").length) using.push(`${rows(ctx, "orders").length} weeks of orders`);
    if (rows(ctx, "campaigns").length) using.push("past campaigns");
    if (base.ok || ctx.inputs.about_the_business) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
