/* D04-W02 Supervised outbound drafts → outreach_draft (first-touch emails; the founder sends). */
import { minimum, need, rows, type Skill } from "./types";

export const outboundDrafts: Skill = {
  id: "D04-W02",
  routineId: "D04-W02",
  name: "Supervised outbound drafts",
  kind: "outreach_draft",
  maxItems: 3,
  purpose: "First-touch outreach emails for right-fit leads, personalised from the lead brief — never sent by Unc",
  inputs: ["the account's latest lead brief artifact (from Lead research & scoring)", "right-fit HubSpot leads (when connected)", "past sent threads (Gmail, when connected)"],
  minimum: minimum("a lead brief from Lead research & scoring first; HubSpot leads give me real names to write to", [], ["lead_brief"], ["hubspot", "gmail"]),
  domain: "sales",
  prompt: `CRAFT — outreach drafts:
- One item per draft. With real lead rows: one per lead (max 3), addressed by first name and company from the row. Without rows: three drafts by segment from the lead brief, with [first name] and [company] placeholders.
- Subject under 6 words, no clickbait. Body 70–120 words: a specific observation about them (only from the material — else a placeholder [what you noticed about them]), the one problem you solve for that segment, one proof line from the business profile, a single low-friction ask (a question, not a meeting).
- Plain text, no bullets, no links unless the founder gave one. Sign-off is the founder's first name if known.
- Never promise results, never mention pricing unless the brief does.
- meta per item: { to: "<name or segment>", company: "<or null>", subject: "…" }.`,
  outputSpec: `{"kind":"outreach_draft","title":"<n> first-touch drafts: <segment>","body":"who these go to and what to personalise before sending","items":[{"title":"<subject>","body":"<the email>","meta":{"to":"…","company":null,"subject":"…"}}],"evidence":[{"source":"artifact:lead_brief|read:leads|site_profile","ref":"…"}]}`,
  check(ctx) {
    const brief = ctx.priorArtifacts.find((a) => a.kind === "lead_brief");
    const using: string[] = [];
    if (brief) using.push(`lead brief “${brief.title}”`);
    const leads = rows(ctx, "leads").length;
    if (leads) using.push(`${leads} right-fit leads`);
    if (brief || ctx.inputs.lead_brief) {
      if (ctx.inputs.lead_brief) using.push("the brief you pasted");
      return { ok: true, using };
    }
    return { ok: false, needs: [need.input("lead_brief", "run Lead research & scoring first (or paste who you're targeting and why they'd care) — I don't write cold email without a brief")] };
  },
};
