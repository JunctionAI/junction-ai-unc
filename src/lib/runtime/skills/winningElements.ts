/* D01-W06 Winning elements library → generic (hooks/formats/offers that beat account average). */
import { knowsTheBusiness, minimum, NEED_BUSINESS, readAnswered, rows, type Skill } from "./types";

export const winningElements: Skill = {
  id: "D01-W06",
  routineId: "D01-W06",
  name: "Winning elements library",
  kind: "generic",
  maxItems: 8,
  purpose: "Hooks, formats and offers that beat this account's average — reusable entries for briefs, measured only from ads rows",
  inputs: ["Meta ads insights at ad level (when connected)", "Instagram organic media (when connected)", "site profile (products, offers, voice) as a schema fallback"],
  file: {
    goal: "A reusable library of hooks, formats and offers that beat account average",
    owns: ["the library artifact", "measured vs schema labels"],
    reads: ["Meta ads insights", "Instagram organic when connected", "site profile when the ads window is empty"],
    decides: ["which elements beat the account average", "how to reuse each one in a brief"],
    writes: ["a generic library artifact of up to eight entries"],
    never: ["invent CTR, spend, purchases or thumbstop", "publish", "spend from this library"],
    apply: "Drafts. I don't publish or spend from this library — you reuse the entries in briefs.",
    examples: [
      { when: "no Meta ads in the window, a scanned site", does: "the library schema (hook / format / offer slots) and the line 'no ads in the window — structure only'" },
      { when: "28 days of ad insights with CTR and purchases", does: "entries that beat account average, numbers cited from those rows only" },
    ],
  },
  minimum: minimum("a scanned site profile so I can structure the library; Meta ads rows are what make an entry a winner", [], ["about_the_business"], ["meta_ads", "instagram"]),
  domain: "content",
  prompt: `CRAFT — winning elements:
- I write at most eight library entries: hooks, formats and offers. Body states the account average only when that number is in the ads material; then each winning item cites the row it beat.
- Only ads rows can make an element a winner. Organic Instagram rows are supporting colour (which formats also save well) — they never invent a paid metric. Without ads rows I produce the library SCHEMA (the slots: hook, format, offer, proof, reuse-in-brief) and I say in the body, verbatim, "no ads in the window — structure only". Every item's meta.status is "schema". I do not guess which hook would have won.
- With ads rows: rank by the primary metrics on the row (spend, purchases, CTR, thumbstop — only those present). Name the transferable element, not the ad name. meta.status "measured". A row missing a metric gets that field as null, never a guess.
- Each item: title = the element in five to eight words; body = why it beat the average (the number from the row), the reusable recipe, and which brief it should feed. Where a recipe needs a fact I don't have, I write [needs a real fact: what would make this true].
- Facts only from the material. No invented volumes, views, rates or discounts. I don't publish and I don't spend. Live mode stays off.
- meta per item: { type: "hook" | "format" | "offer", status: "measured" | "schema", metric: "<name from the row or null>", value: <from the row or null> }.`,
  outputSpec: `{"kind":"generic","title":"Winning elements: <window or schema>","body":"account average (only if in the ads rows) or 'no ads in the window — structure only'","items":[{"title":"<element>","body":"<why it wins + how to reuse>","meta":{"type":"hook","status":"schema","metric":null,"value":null}}],"evidence":[{"source":"read:ads|read:organic|site_profile|input:about_the_business","ref":"…"}]}`,
  check(ctx) {
    const base = knowsTheBusiness(ctx);
    const using = [...base.using];
    const ads = rows(ctx, "ads").length;
    const organic = rows(ctx, "organic").length;
    if (ads) using.push(`${ads} ads`);
    else if (readAnswered(ctx, "ads")) using.push("ads window (empty)");
    if (organic) using.push(`${organic} organic posts`);
    if (ctx.inputs.about_the_business) using.push("your note");
    if (base.ok || ctx.inputs.about_the_business || ads || organic) return { ok: true, using };
    return { ok: false, needs: [NEED_BUSINESS] };
  },
};
