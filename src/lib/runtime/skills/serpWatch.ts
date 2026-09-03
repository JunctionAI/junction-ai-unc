/* D03-W05 SERP position watch → generic (tracked queries that moved; no invented positions). */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const serpWatch: Skill = {
  id: "D03-W05",
  routineId: "D03-W05",
  name: "SERP position watch",
  kind: "generic",
  maxItems: 6,
  purpose: "Tracked queries that moved in Search Console this week, each with the honest response — no invented position changes",
  inputs: ["Search Console query positions and 7-day change (required)"],
  file: {
    goal: "A ranking-movement note from Search Console rows, not a guessed SERP story",
    owns: ["the mover list", "the suggested response per drop or gain"],
    reads: ["Search Console tracked queries"],
    decides: ["which movers are worth a response", "whether the move is a drop to fix or a gain to reinforce"],
    writes: ["a generic artifact"],
    never: ["invent position changes", "claim a ranking Unc did not read"],
    apply: "Drafts. I don't change anything on the site from a ranking move.",
    examples: [
      { when: "GSC shows 'physio auckland' down 5 positions", does: "that query first, position and change from the row, one response" },
      { when: "Search Console is connected but nothing moved 3+", does: "a note that no tracked keyword moved — not a made-up mover list" },
    ],
  },
  minimum: minimum("Search Console ranking data — I can't watch positions I haven't read", ["search_console"], [], []),
  domain: "seo",
  prompt: `CRAFT — SERP position watch:
- Items are tracked queries that actually moved in the Search Console rows (biggest drops first, then biggest gains). Title = the query. Body = current position, the 7-day change, clicks if present, and one response (retitle the owning page, add an FAQ, leave it — the move is noise).
- Positions, changes and clicks only from the rows. Never estimate a position, a delta, or a recovery time. If the rows have no mover of 3+ positions, write that in the body and return no mover items — do not invent a list.
- meta per item: { query: "…", position: <from the row or null>, change: <from the row or null>, clicks: <from the row or null>, response: "fix" | "reinforce" | "noise" }.`,
  outputSpec: `{"kind":"generic","title":"<n> ranking moves this week","body":"what moved, what didn't, the one thing to do — positions only from Search Console","items":[{"title":"<query>","body":"<position · change · the response>","meta":{"query":"…","position":null,"change":null,"clicks":null,"response":"…"}}],"evidence":[{"source":"read:gsc","ref":"…"}]}`,
  check(ctx) {
    const n = rows(ctx, "gsc").length;
    if (n) return { ok: true, using: [`${n} Search Console queries`] };
    if (readAnswered(ctx, "gsc")) return { ok: true, using: ["Search Console"] };
    return { ok: false, needs: [need.platform("search_console", "I need Search Console to watch rankings")] };
  },
};
