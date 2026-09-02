import { describe, expect, it } from "vitest";
import { COMPANY, LEGAL_EFFECTIVE, PRIVACY, TERMS, type LegalBlock, type LegalDoc } from "..";

const textOf = (b: LegalBlock): string => (b.type === "p" ? b.text : b.type === "list" ? b.items.join("\n") : [...b.head, ...b.rows.flat()].join("\n"));
const allText = (d: LegalDoc) => [...d.intro, ...d.sections.flatMap((s) => s.blocks)].map(textOf).join("\n");

for (const doc of [PRIVACY, TERMS]) {
  describe(`${doc.title} — content shape`, () => {
    it("has a title, an effective date and an intro", () => {
      expect(doc.title.length).toBeGreaterThan(3);
      expect(doc.effective).toBe(LEGAL_EFFECTIVE);
      expect(doc.effective).toBe("2 September 2026");
      expect(doc.intro.length).toBeGreaterThan(0);
    });
    it("every section is non-empty, has a stable id and a numbered heading", () => {
      expect(doc.sections.length).toBeGreaterThanOrEqual(10);
      const ids = new Set<string>();
      doc.sections.forEach((s, i) => {
        expect(s.id).toMatch(/^[a-z0-9-]+$/);
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        expect(s.heading.startsWith(`${i + 1}. `)).toBe(true);
        expect(s.blocks.length).toBeGreaterThan(0);
        for (const b of s.blocks) {
          expect(textOf(b).trim().length).toBeGreaterThan(0);
          if (b.type === "list") for (const it of b.items) expect(it.trim().length).toBeGreaterThan(0);
          if (b.type === "table") {
            expect(b.head.length).toBeGreaterThan(1);
            for (const r of b.rows) expect(r).toHaveLength(b.head.length);
          }
        }
      });
    });
    it("carries the company details and no draft placeholders", () => {
      const t = allText(doc);
      expect(t).toContain("JUNCTION CENTRAL LIMITED");
      expect(t).toContain(COMPANY.nzbn);
      expect(t).toContain(COMPANY.companyNumber);
      expect(t).toContain(COMPANY.registeredOffice);
      expect(t).toContain("support@getjunction.ai");
      expect(t).toContain("legal@getjunction.ai");
      expect(t).not.toMatch(/\[PLACEHOLDER/i);
      expect(t).not.toMatch(/\[NZBN\]|\[registered address\]/);
      expect(t).not.toMatch(/DRAFT/);
    });
    it("inline markup is balanced (bold pairs, link brackets)", () => {
      const t = allText(doc);
      expect((t.match(/\*\*/g) ?? []).length % 2).toBe(0);
      expect((t.match(/\]\(/g) ?? []).length).toBe((t.match(/\[[^\]]+\]\(/g) ?? []).length);
    });
  });
}

describe("policy choices are the founder's", () => {
  it("privacy: 30-day deletion, 90-day lapsed retention, privacy@ contact", () => {
    const t = allText(PRIVACY);
    expect(t).toMatch(/within 30 days/);
    expect(t).toMatch(/90 days/);
    expect(t).toContain("privacy@getjunction.ai");
  });
  it("terms: card required for the trial, refunds case by case, NZ courts and no arbitration", () => {
    const t = allText(TERMS);
    expect(t).toMatch(/card is required to start the trial/i);
    expect(t).toMatch(/case by case/);
    expect(t).toMatch(/courts of New Zealand/);
    expect(t).toMatch(/no arbitration/i);
  });
});
