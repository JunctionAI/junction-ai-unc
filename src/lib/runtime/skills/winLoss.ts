/* D04-W05 Win/loss capture → generic (honest close reasons from threads; written to HubSpot after approval). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const winLoss: Skill = {
  id: "D04-W05",
  routineId: "D04-W05",
  name: "Win/loss capture",
  kind: "generic",
  maxItems: 5,
  purpose: "An honest win/loss reason per newly closed HubSpot deal, inferred only from the email trail — otherwise Unc asks",
  inputs: ["HubSpot deals closed won or lost without a reason (required)", "Gmail threads with those contacts (when connected)"],
  file: {
    goal: "A win/loss reason per closed deal, from the thread or an ask — never a guessed why",
    owns: ["the proposed reason per deal", "whether it is inferred or still an ask"],
    reads: ["HubSpot closed deals (required)", "Gmail threads when connected"],
    decides: ["whether the thread is enough to infer a reason", "the one-line reason to write back"],
    writes: ["a generic artifact of proposed CRM reasons"],
    never: ["invent why a deal died", "write the reason to HubSpot without approval"],
    apply: "Drafts the reason. Writing it to HubSpot stays yours until you approve.",
    examples: [
      { when: "a closed-lost deal and a thread saying they went with a cheaper local", does: "reason from that snippet, evidence quoted" },
      { when: "a closed-won deal with no thread", does: "ask what actually closed it — do not invent a why" },
    ],
  },
  minimum: minimum("closed HubSpot deals to capture a reason on; threads let me infer, otherwise I ask", ["hubspot"], [], ["gmail"]),
  domain: "sales",
  prompt: `CRAFT — win/loss capture:
- One item per newly closed deal (max 5). Title = deal name + won or lost (the stage from the row). Body: **Reason** (one sentence), **Evidence** (quoted from a thread snippet or "not on file"), **Ask** (the question for the founder when evidence is missing).
- Infer a reason ONLY from Gmail thread rows tied to that deal's contact. If there is no thread, or the thread does not say why it closed, do not guess — set the reason as an ask ("What actually closed this?" / "Why did this die?") and meta.confidence "ask". Never invent why a deal died, a competitor they chose, a price, or a sentiment.
- Amounts, stages and dates only from the deal rows. Never claim the CRM write has landed.
- meta per item: { deal_id: "<from the row>", stage: "closedwon" | "closedlost" | "<from the row>", reason: "<inferred sentence or null>", confidence: "from_thread" | "ask" }.`,
  outputSpec: `{"kind":"generic","title":"Win/loss on <n> closed deals","body":"which closes, which reasons are from the thread, which still need you","items":[{"title":"<deal> — won|lost","body":"<reason · evidence · ask>","meta":{"deal_id":"…","stage":"…","reason":null,"confidence":"ask"}}],"evidence":[{"source":"read:closed|read:threads","ref":"…"}]}`,
  check(ctx) {
    const closed = rows(ctx, "closed").length;
    if (closed) {
      const using = [`${closed} closed deals`];
      if (rows(ctx, "threads").length) using.push("recent threads");
      return { ok: true, using };
    }
    if (readAnswered(ctx, "closed")) return { ok: true, using: ["HubSpot closed deals"] };
    return { ok: false, needs: [need.platform("hubspot", "closed-won and closed-lost deals to capture a reason on")] };
  },
};
