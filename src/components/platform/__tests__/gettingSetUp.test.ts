/* The "Getting set up" card, rendered per real state with react-dom/server: five rows, cyan
   checks for done steps, exactly one amber (the next action) row, the 'later' honesty on
   connect, the single quiet line at 5/5, nothing once dismissed. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeSetupProgress, type SetupRows } from "@/lib/setup/progress";
import { HOME_COPY } from "@/lib/setup/home";
import GettingSetUp, { type GettingSetUpProps } from "../GettingSetUp";

const noop = () => {};
const NOW = new Date("2026-09-02T09:00:00.000Z");
const rows = (over: Partial<SetupRows> = {}): SetupRows => ({ plans: [], connectors: [], routineStates: [], runs: [], firstTasteEventAt: null, latestBrief: null, clientState: null, resourceProfile: { postures: ["brand_led"], skills: ["Writing"], budget_monthly: 3600 }, ...over });
const render = (props: Partial<GettingSetUpProps>) => renderToStaticMarkup(createElement(GettingSetUp, { progress: null, dismissed: false, onDismiss: noop, onAction: noop, ...props }));
const count = (html: string, needle: string) => (html.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

describe("GettingSetUp — per state", () => {
  it("0/5: five rows, no checks, the plan row carries the one amber dot and the navy pill", () => {
    const html = render({ progress: computeSetupProgress(rows(), NOW) });
    expect(html).toContain('data-testid="getting-set-up"');
    expect(html).toContain("0 of 5 done");
    expect(count(html, 'data-testid="setup-row-')).toBe(5);
    expect(count(html, 'data-testid="setup-check"')).toBe(0);
    expect(count(html, 'data-testid="setup-next-dot"')).toBe(1);
    expect(count(html, 'data-testid="setup-next-action"')).toBe(1);
    expect(html).toContain('data-testid="setup-row-plan" data-done="0" data-next="1"');
    expect(html).toContain("Agree the plan →");
  });

  it("2/5: two cyan checks, amber moves to the routine row with its label", () => {
    const html = render({ progress: computeSetupProgress(rows({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected" }] }), NOW) });
    expect(html).toContain("2 of 5 done");
    expect(count(html, 'data-testid="setup-check"')).toBe(2);
    expect(count(html, 'data-testid="setup-next-dot"')).toBe(1);
    expect(html).toContain('data-testid="setup-row-routine" data-done="0" data-next="1"');
    expect(html).toContain("Turn on Founder content engine →");
    expect(html).toContain("1 connected — Shopify.");
  });

  it("'later' on connect: a quiet 'later' tag, the connect row is never amber, the routine row is", () => {
    const html = render({ progress: computeSetupProgress(rows({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], clientState: { setupConnectLater: true } }), NOW) });
    expect(html).toContain(">later<");
    expect(html).toContain('data-testid="setup-row-connect" data-done="0" data-next="0"');
    expect(html).toContain('data-testid="setup-row-routine" data-done="0" data-next="1"');
    expect(html).toContain("You said later. Connect Instagram and I&#x27;ll read your last 90 days tonight.");
  });

  it("4/5: review done, the brief row is the action", () => {
    const html = render({
      progress: computeSetupProgress(
        rows({
          plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }],
          connectors: [{ platform: "shopify", status: "connected" }],
          routineStates: [{ routine_id: "D01-W01", enabled: true }],
          runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00.000Z" }],
          firstTasteEventAt: "2026-09-02T08:00:00.000Z",
        }),
        NOW,
      ),
    });
    expect(count(html, 'data-testid="setup-check"')).toBe(4);
    expect(html).toContain('data-testid="setup-row-brief" data-done="0" data-next="1"');
    expect(html).toContain("Write today&#x27;s brief →");
  });

  it("5/5: one quiet line with Hide; dismissed: nothing", () => {
    const p = computeSetupProgress(
      rows({
        plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }],
        connectors: [{ platform: "shopify", status: "connected" }],
        routineStates: [{ routine_id: "D01-W01", enabled: true }],
        runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00.000Z" }],
        firstTasteEventAt: "2026-09-02T08:00:00.000Z",
        latestBrief: { day: "2026-09-02" },
      }),
      NOW,
    );
    const html = render({ progress: p });
    expect(html).toContain('data-testid="getting-set-up-done"');
    expect(html).toContain(HOME_COPY.setupDone);
    expect(html).toContain("Hide");
    expect(html).not.toContain('data-testid="setup-row-');
    expect(render({ progress: p, dismissed: true })).toBe("");
  });

  it("loading: the checking line; error: nothing (Home already says the runtime is unreachable)", () => {
    expect(render({ progress: null, loading: true })).toContain("getting-set-up-loading");
    expect(render({ progress: null, error: "boom" })).toBe("");
    expect(render({ progress: null })).toBe("");
  });
});
