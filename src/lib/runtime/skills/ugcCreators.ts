/* D01-W04 UGC creator pipeline → outreach_draft (briefing + outreach drafts; never sent). */
import { knowsTheBusiness, minimum, need, rows, type Skill } from "./types";

export const ugcCreators: Skill = {
  id: "D01-W04",
  routineId: "D01-W04",
  name: "UGC creator pipeline",
  kind: "outreach_draft",
  maxItems: 5,
  purpose: "A creator briefing and five outreach drafts for the founder to send — Unc never scrapes people or hits send",
  inputs: ["the founder's creator brief (niche, follower band, region — asked for when missing)", "Instagram hashtag creator rows (when connected)", "repeat Shopify customers (when connected)", "vars.hashtags", "site profile (product to send, voice)"],
  file: {
    goal: "A briefing plus five outreach drafts the founder sends — never a scraped people list",
    owns: ["the outreach_draft artifact", "the briefing in the body"],
    reads: ["founder creator brief", "Instagram creator rows when connected", "repeat customers when connected", "site profile"],
    decides: ["who fits the brief", "the offer and usage line", "which five to write"],
    writes: ["an outreach_draft artifact of up to five items"],
    never: ["scrape people", "invent usernames or handles", "send outreach"],
    apply: "Drafts. I never send. You send, or we graduate the briefing once you keep the same creator fit.",
    examples: [
      { when: "founder describes 'micro creators in Auckland, 2–20k followers, physio/wellness'", does: "briefing + five drafts with [creator handle] placeholders, no invented names" },
      { when: "Instagram hashtag_search returns five usernames", does: "one draft each, handle and followers from the row only" },
    ],
  },
  minimum: minimum("a description of who you want (niche, follower band, region); Instagram rows let me name real handles", [], ["creator_brief"], ["instagram", "shopify"]),
  domain: "content",
  prompt: `CRAFT — UGC creator pipeline:
- I write a briefing in the body first: who we want (niche, follower band, region — only from the founder brief or the filter on the rows), the product to send (from the profile), the usage rights in one plain sentence, what "a good piece" looks like. Then at most five outreach drafts as items.
- With real creator rows: one draft per handle from the row (max 5), addressed to that username, followers only if the row has them. I never add a person who is not on a row.
- Without creator rows: five drafts from the founder brief, every address is the placeholder [creator handle]. I never invent a username, a real name, an email or an engagement rate. Repeat Shopify customers may inform the briefing ("buyers who ordered more than once") — I still don't turn an email into a handle.
- Each draft: a short Instagram DM or email, 70–120 words, in the brand's voice. One specific reason they fit (from the brief or the row), one clear ask (a gifted product + usage), no hype, no invented discount. Where a line needs a fact I don't have, I write [needs a real fact: what would make this true].
- Facts only from the material. I don't scrape people, I don't publish, I don't send. Live mode stays off.
- meta per item: { to: "<handle or [creator handle]>", followers: <from the row or null>, channel: "instagram_dm" | "email", source: "row" | "brief" }.`,
  outputSpec: `{"kind":"outreach_draft","title":"<n> creator drafts: <niche>","body":"the briefing (who, offer, usage, product) and that these are for you to send","items":[{"title":"<first line or subject>","body":"<the DM/email>","meta":{"to":"[creator handle]","followers":null,"channel":"instagram_dm","source":"brief"}}],"evidence":[{"source":"input:creator_brief|read:creators|read:customers|site_profile","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const base = knowsTheBusiness(ctx);
    using.push(...base.using);
    const creators = rows(ctx, "creators").length;
    const customers = rows(ctx, "customers").length;
    if (creators) using.push(`${creators} creator candidates`);
    if (customers) using.push(`${customers} repeat customers`);
    if (ctx.vars.hashtags) using.push(`hashtags ${String(ctx.vars.hashtags)}`);
    if (ctx.inputs.creator_brief) using.push("your creator brief");
    if (ctx.inputs.creator_brief || creators) return { ok: true, using };
    return { ok: false, needs: [need.input("creator_brief", "describe who you want: niche, follower band and region — I don't scrape people or invent handles")] };
  },
};
