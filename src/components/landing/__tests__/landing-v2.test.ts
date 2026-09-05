import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LandingV2, { LANDING_AGENTS } from "../LandingV2";
import { normalizeSource } from "@/lib/waitlist/store";

describe("supplied landing v2 production truth", () => {
  it("renders concrete work with real navigation and a signup form", () => {
    const html = renderToStaticMarkup(createElement(LandingV2));
    for (const value of ["Grow your", "sales and marketing agents", "Choose the work", 'href="/login"', 'href="/privacy"', 'href="/terms"', 'id="waitlist-v2"', 'type="email"']) expect(html).toContain(value);
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain("text/x-dc");
  });
  it("does not advertise prototype metrics, pricing or external actions as delivered", () => {
    const html = renderToStaticMarkup(createElement(LandingV2));
    for (const value of ["budget moved", "updated daily", "2.5 hours", "US$100", "14-day free trial"]) expect(html).not.toContain(value);
    expect(html).toContain("not live controls");
    expect(html).toContain("Illustrative handoff");
    expect(html).toContain("Publishing and customer messaging remain disabled");
  });
  it("records category interest within the existing source contract, not runtime IDs", () => {
    const source = ["landing_v2", ...LANDING_AGENTS.map(a => a.id)].join("-");
    expect(source.length).toBeLessThanOrEqual(64);
    expect(normalizeSource(source)).toBe(source);
    expect(LANDING_AGENTS.reduce((n, a) => n + a.tasks.length, 0)).toBe(15);
  });
});
