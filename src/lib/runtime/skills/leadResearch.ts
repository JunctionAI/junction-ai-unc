/* D04-W01 Lead research & scoring → lead_brief (a research brief template + scoring criteria —
   never scraped people). */
import { knowsTheBusiness, minimum, need, rows, type Skill } from "./types";

export const leadResearch: Skill = {
  id: "D04-W01",
  routineId: "D04-W01",
  name: "Lead research & scoring",
  kind: "lead_brief",
  maxItems: 8,
  purpose: "An ICP definition, a scoring rubric and a research brief template for the leads the founder wants — no scraping of people",
  inputs: ["the founder's description of the target buyer (asked for when missing)", "new HubSpot leads (when connected)", "site profile (what is sold, to whom)"],
  file: {
    goal: "An ICP, a scoring rubric and a research brief — never a scraped people list",
    owns: ["the lead_brief artifact", "the scoring criteria"],
    reads: ["founder target description", "HubSpot leads when connected", "site profile"],
    decides: ["how to score a fit", "which fields the research template asks for"],
    writes: ["a lead_brief artifact"],
    never: ["scrape people", "invent job titles or companies", "email anyone"],
    apply: "Drafts. HubSpot rows let me score real leads; I still don't outreach from this skill.",
    examples: [
      { when: "founder describes 'gym owners in Auckland'", does: "ICP + rubric + a blank research template, no names" },
      { when: "HubSpot has 8 new leads", does: "score those rows against the rubric, names from the CRM only" },
    ],
  },
  minimum: minimum("a description of who you want to reach (I ask for it); HubSpot leads let me score real rows", [], ["target_description"], ["hubspot"]),
  domain: "sales",
  prompt: `CRAFT — lead research brief:
- Body: the ICP in one paragraph (who, size, trigger event, why now), then the scoring rubric — five criteria, each with what a 0 / 1 / 2 looks like, and the threshold for "worth outreach".
- Items: (1) the research checklist per lead (what to look for on their site, LinkedIn, news — public, business-level facts only), (2) the disqualifiers, (3) the one-line "why you" per segment, then — ONLY when real HubSpot lead rows are in the material — one item per lead with a provisional score and the evidence used (company-level facts from the rows; never invent details about a person).
- No scraping of people, no guessed emails, no invented company facts. If a lead row lacks a company or website, score it "unknown — ask".
- meta per item: { type: "checklist" | "disqualifiers" | "why_you" | "lead", score: <0-10 or null>, company: "<from the row or null>" }.`,
  outputSpec: `{"kind":"lead_brief","title":"Lead brief: <ICP in five words>","body":"<ICP paragraph + rubric, markdown>","items":[{"title":"…","body":"…","meta":{"type":"…","score":null,"company":null}}],"evidence":[{"source":"input:target_description|site_profile|read:leads","ref":"…"}]}`,
  check(ctx) {
    const using: string[] = [];
    const base = knowsTheBusiness(ctx);
    using.push(...base.using);
    const leads = rows(ctx, "leads").length;
    if (leads) using.push(`${leads} new leads`);
    if (ctx.inputs.target_description) {
      using.push("your target description");
      return { ok: true, using };
    }
    return { ok: false, needs: [need.input("target_description", "describe who you want to reach — role, company type and size, region, and what makes them a good fit")] };
  },
};
