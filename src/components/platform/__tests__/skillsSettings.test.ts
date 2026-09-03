/* The Skills settings (owner / member / admin views, sources, test results) rendered to a string;
   the sidebar's "Skills" link in accounts mode; the routine detail's "Powered by your n8n
   workflow" line. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import { skillRows } from "@/lib/n8n/registry";
import type { RoutinesStateListing } from "@/lib/runtime/routinesState";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import RoutineDetail from "../RoutineDetail";
import Sidebar from "../Sidebar";
import SkillsSettings, { SKILLS_COPY, type SkillsPayload } from "../SkillsSettings";

const noop = () => {};
const ACCT = "00000000-0000-4000-8000-00000000acc1";

function payload(over: Partial<SkillsPayload> = {}): SkillsPayload {
  const routines = skillRows(
    [
      { id: "wf-own", accountId: ACCT, routineId: "D01-W01", webhookUrl: "https://n8n.example/webhook/founder", active: true },
      { id: "wf-global", accountId: null, routineId: "D01-W03", webhookUrl: "https://n8n.example/webhook/questions", active: false },
    ],
    ACCT,
  );
  return { routines, owner: true, admin: false, secretConfigured: true, dataBaseUrl: "https://unc.test", budget: { spentUsd: 3.2, capUsd: 15, ok: true }, ...over };
}

const render = (p: SkillsPayload) => renderToStaticMarkup(createElement(SkillsSettings, { onClose: noop, initial: p }));

describe("SkillsSettings", () => {
  it("lists all 35 routines with their source, the workflows that apply, the budget line; owner sees the inputs", () => {
    const html = render(payload());
    for (const s of ALL_SYSTEMS) expect(html).toContain(`data-testid="skill-${s.id}"`);
    expect(html).toContain('data-testid="skill-D01-W01" data-source="n8n"');
    expect(html).toContain('data-testid="skill-D01-W03" data-source="builtin"'); // the global row is paused → built-in serves
    expect(html).toContain('data-testid="skill-D02-W04" data-source="none"');
    expect(html).toContain("https://n8n.example/webhook/founder");
    expect(html).toContain("this account");
    expect(html).toContain("every account");
    expect(html).toContain("paused");
    expect(html).toContain(SKILLS_COPY.budgetLine(3.2, 15).replace(/\$/g, "$"));
    expect(html).toContain("Use this workflow");
    expect(html).toContain("Replace");
    expect(html).not.toContain('data-testid="skills-admin-spend"');
    expect(html).not.toContain('data-testid="skills-no-secret"');
    // a member cannot pause a global row; an owner cannot either (admin only)
    expect(html.split("Pause").length - 1).toBe(1);
  });

  it("a member sees the listing without inputs; no secret → the honest banner; over budget → the line", () => {
    const html = render(payload({ owner: false, secretConfigured: false, budget: { spentUsd: 15.5, capUsd: 15, ok: false } }));
    expect(html).not.toContain("Use this workflow");
    expect(html).toContain("Only the account owner");
    expect(html).toContain('data-testid="skills-no-secret"');
    expect(html).toContain(SKILLS_COPY.budgetOut);
  });

  it("an admin sees the global checkbox, can pause a global row, and every account's spend", () => {
    const html = render(payload({ admin: true, accounts: [{ accountId: ACCT, name: "Example Co", spentUsd: 3.2, capUsd: 15, ok: true }, { accountId: "b", name: "Over Co", spentUsd: 16, capUsd: 15, ok: false }] }));
    expect(html).toContain('data-testid="skills-admin-spend"');
    expect(html).toContain("Example Co");
    expect(html).toContain("US$16.00");
    expect(html.split("every account").length - 1).toBeGreaterThan(1);
    expect(html.split("Activate").length - 1).toBe(1);
  });
});

describe("Sidebar + RoutineDetail", () => {
  it("accounts mode shows the Skills link next to Models; demo mode has neither", () => {
    const S: PlatformState = { ...initialState, onboarded: true };
    const V = derive(S, noop);
    const account = { mode: "account" as const, accountId: ACCT, accountName: "Example", userEmail: "f@example.test", autosave: "saved" as const, hydrated: true } as unknown as Parameters<typeof Sidebar>[0]["account"];
    const html = renderToStaticMarkup(createElement(Sidebar, { V, account, onModels: noop, onSkills: noop }));
    expect(html).toContain('data-testid="sidebar-skills"');
    expect(html).toContain(">Skills<");
    expect(html).toContain(">Models<");
    expect(renderToStaticMarkup(createElement(Sidebar, { V }))).not.toContain("sidebar-skills");
  });

  it("routine detail says 'Powered by your n8n workflow' only when the listing says n8n", () => {
    const base = (source: "n8n" | "builtin"): RoutinesStateListing => ({
      routines: [{ routineId: "D01-W01", name: "Founder content engine", category: "Content", wave: 1, enabled: true, version: 1, availability: "draft_only", availabilityCopy: "drafts only", canEnable: true, betterWith: [], betterWithCopy: null, recommended: false, lastRun: null, lastDraft: null, skillSource: source }],
      recommendedFirst: [],
      planChannel: null,
      connected: [],
      business: { businessType: null, sells: null, storefront: null },
    });
    const S: PlatformState = { ...initialState, onboarded: true, view: "systems", sel: ALL_SYSTEMS.find((s) => s.id === "D01-W01")! };
    const run = { accountId: ACCT, account: { currency: "NZD", budgetMonthly: 3000 }, persisted: true };
    const withN8n = renderToStaticMarkup(createElement(RoutineDetail, { V: derive(S, noop), run, live: { data: base("n8n"), loading: false, error: null, refresh: noop } as unknown as Parameters<typeof RoutineDetail>[0]["live"] }));
    expect(withN8n).toContain('data-testid="skill-source-n8n"');
    expect(withN8n).toContain("Powered by your n8n workflow");
    const builtin = renderToStaticMarkup(createElement(RoutineDetail, { V: derive(S, noop), run, live: { data: base("builtin"), loading: false, error: null, refresh: noop } as unknown as Parameters<typeof RoutineDetail>[0]["live"] }));
    expect(builtin).not.toContain("skill-source-n8n");
  });
});
