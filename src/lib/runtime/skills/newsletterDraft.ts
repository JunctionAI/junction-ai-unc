/* D05-W08 Newsletter draft production → email (one founder-led campaign draft). Store only. */
import { knowsTheBusiness, minimum, NEED_BUSINESS, need, rows, type Skill } from "./types";

export const newsletterDraft: Skill = {
  id: "D05-W08",
  routineId: "D05-W08",
  name: "Newsletter draft production",
  kind: "email",
  maxItems: 1,
  purpose: "One review-ready newsletter drafted from the founder's actual brief, approved brand facts and verified links",
  inputs: [
    "newsletter mode: founder_letter or visual_drop",
    "the founder's brief: what happened, why now and the one next action",
    "site profile and approved business memories",
    "past campaigns (Klaviyo, when connected)",
    "products (Shopify, when connected)",
    "verified destination and asset references when the draft needs them",
  ],
  file: {
    goal: "Turn one real founder brief into one complete newsletter draft for review",
    owns: ["the draft subject, preview, body and build brief", "the copy-quality and missing-fact checks"],
    reads: ["the founder's newsletter brief and chosen mode", "site profile and approved business memories", "past campaigns and products when available"],
    decides: ["the clearest truthful structure and wording", "which missing facts must remain explicit placeholders"],
    writes: ["one email artifact and draft receipt"],
    never: ["invent a founder story, claim, offer, deadline, URL or asset", "create, schedule, test-send or send a provider campaign"],
    apply: "Drafts only. A provider draft build and every send remain separately approved actions with their own readback.",
    examples: [
      { when: "a founder supplies a real announcement, reason and reply CTA", does: "a plain founder-letter draft preserving that point of view" },
      { when: "a product drop has verified product facts, URL and imagery", does: "a concise visual-drop draft plus an explicit asset and link manifest" },
    ],
  },
  minimum: minimum("a newsletter mode, the founder's real brief and enough approved business context to avoid invention", [], ["newsletter_mode", "newsletter_brief", "about_the_business"], ["klaviyo", "shopify"]),
  domain: "email",
  prompt: `CRAFT — supervised newsletter draft:
- Make exactly one email. newsletter_mode must be founder_letter or visual_drop. Preserve the founder's actual point of view and rough edges; add only the structure needed to make it clear.
- The brief must establish what happened, why it matters now and one next action. Never manufacture a story, emotion, customer result, product fact, offer, deadline, scarcity claim, social proof, link or image. Put a precise [needs: ...] placeholder where an unverified fact is essential.
- Subject <= 45 characters. Preview extends rather than repeats it. Use one primary CTA or reply invitation. Keep a founder letter personal and visually simple; keep a visual drop concise and product-first.
- Body includes the complete ready-to-review copy followed by a compact build brief: mode, section order, CTA, verified link or placeholder, asset/alt-text needs, unresolved facts and approval owner. Do not claim a Klaviyo draft exists.
- Past campaign rows may inform mechanics and fatigue only. Recency is not performance; missing metrics are unknown, never zero. Never copy another campaign's expression.
- meta: { mode: "founder_letter" | "visual_drop", subject: "...", preview: "...", cta_label: "..." | null, destination_url: "..." | null, provider_draft_id: null }.
- End the artifact body with PASS, PARTIAL or BLOCKED for draft readiness and the smallest next decision.`,
  outputSpec: `{"kind":"email","title":"Newsletter draft: <topic>","body":"the complete copy, build brief, unresolved facts, approval owner and PASS|PARTIAL|BLOCKED","items":[{"title":"<subject>","body":"<preview + complete email copy + build brief, markdown>","meta":{"mode":"founder_letter","subject":"...","preview":"...","cta_label":null,"destination_url":null,"provider_draft_id":null}}],"evidence":[{"source":"input:newsletter_brief|site_profile|memory|read:campaigns|read:products","ref":"..."}]}`,
  check(ctx) {
    const needs = [];
    const mode = ctx.inputs.newsletter_mode?.trim();
    if (mode !== "founder_letter" && mode !== "visual_drop") needs.push(need.input("newsletter_mode", "choose plain founder letter or graphic visual drop"));
    if (!ctx.inputs.newsletter_brief?.trim()) needs.push(need.input("newsletter_brief", "share what happened, why it matters now and the one next action"));
    const business = knowsTheBusiness(ctx);
    if (!business.ok && !ctx.inputs.about_the_business?.trim()) needs.push(NEED_BUSINESS);
    if (needs.length) return { ok: false, needs };
    const using = [...business.using];
    if (ctx.inputs.about_the_business?.trim()) using.push("your note about the business");
    using.push(`${mode === "founder_letter" ? "founder letter" : "visual drop"} mode`, "your newsletter brief");
    if (rows(ctx, "campaigns").length) using.push("past campaigns");
    if (rows(ctx, "products").length) using.push("verified products");
    return { ok: true, using };
  },
};
