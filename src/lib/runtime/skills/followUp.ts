/* D04-W04 Follow-up cadence → outreach_draft (nudges for deals gone quiet; founder sends). */
import { minimum, need, rows, type Skill } from "./types";

export const followUp: Skill = {
  id: "D04-W04",
  routineId: "D04-W04",
  name: "Follow-up cadence",
  kind: "outreach_draft",
  maxItems: 5,
  purpose: "Follow-up emails for open deals that have gone quiet, picking up the last thread — never sent by Unc",
  inputs: ["open HubSpot deals with last activity older than the cadence (when connected)", "recent Gmail threads with those contacts (when connected)", "a pasted list of deals gone quiet"],
  file: {
    goal: "Follow-up drafts for deals gone quiet — Unc never hits send",
    owns: ["the outreach_draft artifact", "which stale deals get a nudge this run"],
    reads: ["HubSpot open deals when connected", "Gmail threads when connected", "a pasted stale-deal list"],
    decides: ["which quiet deals are worth a nudge", "the opening line from the last thread"],
    writes: ["an outreach_draft artifact"],
    never: ["send the follow-up", "invent a personal detail", "invent a response time"],
    apply: "Drafts. Sending stays yours.",
    examples: [
      { when: "founder pastes three deals gone quiet", does: "one draft each, [first name] [company] placeholders where the paste has no name" },
      { when: "HubSpot has 4 open deals with no activity in 5 days and Gmail has the last thread", does: "pick up that subject, no invented personal detail" },
    ],
  },
  minimum: minimum("open deals gone quiet from HubSpot, or a list you paste; Gmail threads let me pick up the last conversation", [], ["stale_deals"], ["hubspot", "gmail"]),
  domain: "sales",
  prompt: `CRAFT — follow-up cadence:
- One item per stale deal (max 5). With HubSpot deal rows: address by the contact name and company from the row. Without rows: drafts from the pasted list, with [first name] and [company] placeholders where those fields are missing.
- Subject under 6 words, continues the last thread when a Gmail row exists (Re: <their subject>), otherwise a plain nudge. Body 60–110 words: one specific callback to the last thread or deal note (only from the material — else [what you last promised them]), the one next step, a single low-friction ask. Plain text, no bullets, no links unless the founder gave one. Sign-off is the founder's first name if known.
- Never invent a personal detail, a meeting that isn't on file, a dollar amount, or a response time. Missing material reads as a placeholder, not a guess. Never claim the email was sent.
- meta per item: { to: "<name or placeholder>", company: "<or null>", deal: "<from the row or the paste>", subject: "…", last_activity: "<from the row or null>" }.`,
  outputSpec: `{"kind":"outreach_draft","title":"<n> follow-ups for deals gone quiet","body":"which deals, what the last thread was, what to personalise before sending — Unc does not send","items":[{"title":"<subject>","body":"<the email>","meta":{"to":"…","company":null,"deal":"…","subject":"…","last_activity":null}}],"evidence":[{"source":"read:deals|read:threads|input:stale_deals","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const deals = rows(ctx, "deals").length;
    if (deals) using.push(`${deals} stale deals`);
    if (rows(ctx, "threads").length) using.push("recent threads");
    if (ctx.inputs.stale_deals) using.push("the deals you pasted");
    if (deals || ctx.inputs.stale_deals) return { ok: true, using };
    return { ok: false, needs: [need.platform("hubspot", "open deals that have gone quiet"), need.input("stale_deals", "or paste the deals gone quiet — name, stage, last activity, and who to write to")] };
  },
};
