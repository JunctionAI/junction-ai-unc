/* D04-W06 Pipeline hygiene → generic (close-lost list from stale HubSpot rows only). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const pipelineHygiene: Skill = {
  id: "D04-W06",
  routineId: "D04-W06",
  name: "Pipeline hygiene",
  kind: "generic",
  maxItems: 1,
  purpose: "The close-lost list for open HubSpot deals that are actually stale on the rows — never a guessed count, applied only after approval",
  inputs: ["open HubSpot deals with stage, amount, close date, last activity (required)"],
  file: {
    goal: "A close-lost list taken only from HubSpot rows that are actually stale",
    owns: ["the proposed close-lost list", "the stale rule applied to the rows"],
    reads: ["HubSpot open deals (required)"],
    decides: ["which rows are dead (no activity 30+ days, no future close date)", "whether the list is small enough to propose closing"],
    writes: ["a generic artifact with the close-lost list"],
    never: ["invent stale counts", "close deals without approval"],
    apply: "Drafts the close-lost list. Closing deals stays yours until you approve.",
    examples: [
      { when: "3 open deals with last_activity 40+ days ago and no future close date", does: "those three on the close-lost list, amounts from the rows" },
      { when: "every open deal has activity this month", does: "say the pipeline is clean from the rows — not a made-up stale count" },
    ],
  },
  minimum: minimum("open HubSpot deals — I only propose close-lost from rows that are actually stale", ["hubspot"], [], []),
  domain: "sales",
  prompt: `CRAFT — pipeline hygiene:
- One item: the close-lost list. Title = "Close-lost: <n> stale deals" where n is the count of rows that qualify, or "Pipeline is clean" when none do. Body = the rule you applied (no activity 30+ days and no close date in the future), then a markdown list of qualifying deals: name, stage, amount, last activity / days_stale — every figure from the row.
- A deal qualifies only when the row itself shows it: days_stale ≥ 30, or last_activity old enough, and no future close_date. If a row is missing last_activity and days_stale, leave it off the list and say so — do not guess it is dead. If no row qualifies, say the pipeline is clean from these rows; do not invent a stale count.
- Amounts, stages and dates only from the material. Never claim the deals have been closed.
- meta: { deal_ids: ["<from qualifying rows>"], stale_over_days: 30, count: <qualifying row count> }.`,
  outputSpec: `{"kind":"generic","title":"Close-lost: <n> stale deals","body":"the rule, the list (name · stage · amount · last activity) — counts only from the rows","items":[{"title":"Close-lost list","body":"<markdown list or 'nothing stale on these rows'>","meta":{"deal_ids":[],"stale_over_days":30,"count":0}}],"evidence":[{"source":"read:deals","ref":"…"}]}`,
  check(ctx) {
    const deals = rows(ctx, "deals").length;
    if (deals) return { ok: true, using: [`${deals} open deals`] };
    if (readAnswered(ctx, "deals")) return { ok: true, using: ["HubSpot deals"] };
    return { ok: false, needs: [need.platform("hubspot", "open deals so I can propose a close-lost list from rows that are actually stale")] };
  },
};
