/* Legal documents as typed section arrays — edit the words in ./privacy.ts and ./terms.ts
   without touching layout (src/components/legal/LegalDocument.tsx renders them).

   Inline markup allowed inside any string: **bold** and [text](href). Nothing else. */

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] };

export interface LegalSection {
  /** URL fragment (#…) — stable, lower-kebab. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  slug: "privacy" | "terms";
  title: string;
  /** Rendered as the small "Effective …" line under the title. */
  effective: string;
  /** Short lead-in before the first h2. */
  intro: LegalBlock[];
  sections: LegalSection[];
}

/* Company details shared by both documents (one place to change). */
export const COMPANY = {
  legalName: "JUNCTION CENTRAL LIMITED",
  form: "a New Zealand limited company",
  companyNumber: "7879076",
  nzbn: "9429047921313",
  incorporated: "4 February 2020",
  registeredOffice: "34 Ngataringa Road, Devonport, Auckland 0624, New Zealand",
  support: "support@getjunction.ai",
  legal: "legal@getjunction.ai",
  privacy: "privacy@getjunction.ai",
} as const;

export const LEGAL_EFFECTIVE = "2 September 2026";

export const p = (text: string): LegalBlock => ({ type: "p", text });
export const list = (...items: string[]): LegalBlock => ({ type: "list", items });
export const table = (head: string[], rows: string[][]): LegalBlock => ({ type: "table", head, rows });
