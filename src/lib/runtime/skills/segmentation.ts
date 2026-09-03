/* D05-W03 Segmentation refresh → generic (up to five segment definitions, re-fitted). Store only. */
import { minimum, need, readAnswered, rows, type Skill } from "./types";

export const segmentation: Skill = {
  id: "D05-W03",
  routineId: "D05-W03",
  name: "Segmentation refresh",
  kind: "generic",
  maxItems: 5,
  purpose: "Segment definitions re-fitted to this store's customer rows — who is VIP, active, lapsed, new, never-purchased",
  inputs: ["customers (Shopify — required)", "current Klaviyo segments (when connected)", "site profile"],
  file: {
    goal: "Up to five segment definitions fitted to this year's customers",
    owns: ["the proposed segment definitions"],
    reads: ["Shopify customers (required)", "Klaviyo segments when connected"],
    decides: ["which definitions to propose or refresh", "the thresholds fitted to the rows"],
    writes: ["a generic artifact of up to five definitions"],
    never: ["invent a drift percentage or a profile count", "publish segment changes", "run for a non-store"],
    apply: "Drafts. Segment updates stay yours until we graduate this routine.",
    examples: [
      { when: "customers show a clear top-spend cluster and a 90-day gap", does: "VIP / Active / Lapsed / New / Never purchased, thresholds taken from the rows" },
      { when: "Klaviyo already has VIP and Lapsed 90d", does: "refresh those two plus any missing core segment; no invented drift %" },
    ],
  },
  minimum: minimum("a Shopify store with customer rows, plus Klaviyo segments — this routine is for stores", ["shopify", "klaviyo"], [], []),
  domain: "email",
  prompt: `CRAFT — segmentation refresh:
- Up to five items = proposed Klaviyo segment definitions, fitted to the customer rows (orders_count, total_spent, last_order_at). Prefer the core set the list actually needs: Active (purchased recently), Lapsed, VIP (top spenders in these rows), New subscribers/first-order, Never purchased — skip any the rows cannot support.
- Each item: title = the segment name; body = the definition in plain words (the filter a human could paste), why it fits these rows (cite counts only from the rows or the segments metrics), and what campaigns/flows should use it.
- Never invent a drift percentage, a profile count or a spend threshold you did not compute from the rows. If segments metrics include drift_pct or drifted_count, cite them; otherwise say you have not measured drift.
- When current segment rows exist, refresh names that already live in Klaviyo rather than inventing parallel ones. Don't invent what a segment currently contains.
- meta per item: { name: "…", definition: "…", size: <count from the customer rows or null> }.`,
  outputSpec: `{"kind":"generic","title":"<n> segment definitions re-fitted","body":"what the customer rows show (counts only if measured) and which definitions you are proposing or refreshing — no invented drift %","items":[{"title":"<segment name>","body":"<definition + why + who it is for>","meta":{"name":"…","definition":"…","size":null}}],"evidence":[{"source":"read:customers|read:segments|site_profile|memory","ref":"…"}]}`,
  check(ctx) {
    if (!readAnswered(ctx, "customers")) {
      return { ok: false, needs: [need.platform("shopify", "customer rows are the material — this routine only applies to a store")] };
    }
    const n = rows(ctx, "customers").length;
    if (!n) {
      return { ok: false, needs: [need.platform("shopify", "customer rows to re-fit the segments — none came back")], note: "No customer rows to segment from." };
    }
    const using = [`${n} customers`];
    const segs = rows(ctx, "segments").length;
    if (segs) using.push(`${segs} Klaviyo segments`);
    return { ok: true, using };
  },
};
