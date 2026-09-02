/* "What I drafted" with real artifacts (react-dom/server): the card renders the routine tag,
   kind chip, title and preview collapsed; open shows the markdown body, the items, the
   actions; Home in accounts mode renders artifacts over the receipt rows; RunNowPanel shows
   the waiting_input ask. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactView } from "@/lib/artifacts/handlers";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import DraftCard, { Markdown } from "../DraftCard";
import Drafts from "../Drafts";
import HomeView from "../HomeView";
import { runStatusHeading } from "../RunNowPanel";
import type { LiveApprovals } from "../useLiveApprovals";

const noop = () => {};
const art = (over: Partial<ArtifactView> = {}): ArtifactView => ({
  id: "a1",
  runId: "r1",
  routineId: "D01-W01",
  routineName: "Founder content engine",
  category: "Content",
  kind: "post_set",
  title: "3 founder posts: why we ship from Auckland",
  body: "## What these do\n\nThree posts from the **site profile** and 3 customer questions.\n\n- question\n- belief",
  editedBody: null,
  items: [{ title: "Does it ship to AU?", body: "Yes — here is what it costs us.", meta: { angle: "question", platform: "linkedin" } }],
  meta: { via: "producer", using: ["site profile", "3 customer questions"] },
  evidence: [{ source: "site_profile", ref: "ships from Auckland" }],
  status: "draft",
  preview: "What these do · Three posts from the site profile and 3 customer questions.",
  createdAt: "2026-09-03T07:00:00.000Z",
  ...over,
});

describe("DraftCard", () => {
  it("collapsed: tag, kind chip, title, preview, Open; status pill amber while waiting", () => {
    const html = renderToStaticMarkup(createElement(DraftCard, { artifact: art() }));
    expect(html).toContain('data-testid="draft-card"');
    expect(html).toContain("D01-W01");
    expect(html).toContain("Post set");
    expect(html).toContain("3 founder posts: why we ship from Auckland");
    expect(html).toContain("What these do · Three posts");
    expect(html).toContain('data-testid="artifact-open"');
    expect(html).toContain("Waiting on you");
    expect(html).not.toContain('data-testid="artifact-items"');
  });

  it("open: markdown body (heading, bold, list), the items with their meta, Approve / Hold / Why / Edit / Copy, send buttons per channel", () => {
    const html = renderToStaticMarkup(createElement(DraftCard, { artifact: art(), defaultOpen: true, channels: ["telegram", "bogus"] }));
    expect(html).toContain('data-testid="artifact-markdown"');
    expect(html).toContain("<strong>site profile</strong>");
    expect(html).toContain("<li>question</li>");
    expect(html).toContain('data-testid="artifact-items"');
    expect(html).toContain("1. Does it ship to AU?");
    expect(html).toContain("platform: linkedin");
    expect(html).toContain('data-testid="artifact-approve"');
    expect(html).toContain('data-testid="artifact-hold"');
    expect(html).toContain("Why?");
    expect(html).toContain("Copy");
    expect(html).toContain("Send me this on Telegram");
    expect(html).not.toContain("bogus");
  });

  it("an approved artifact shows no Approve / Hold; an edited one renders the founder's words", () => {
    const approved = renderToStaticMarkup(createElement(DraftCard, { artifact: art({ status: "approved" }), defaultOpen: true }));
    expect(approved).toContain("Approved");
    expect(approved).not.toContain('data-testid="artifact-approve"');
    const edited = renderToStaticMarkup(createElement(DraftCard, { artifact: art({ status: "edited", editedBody: "My own words here." }), defaultOpen: true }));
    expect(edited).toContain("My own words here.");
    expect(edited).not.toContain("<strong>site profile</strong>");
  });

  it("Markdown renders quotes, rules and ordered lists", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { body: "> a quote\n\n---\n\n1. one\n2. two" }));
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
    expect(html).toContain("<ol");
  });
});

describe("Drafts", () => {
  it("renders the artifacts; with none, the receipt rows; with neither, the copy floor", () => {
    const withArt = renderToStaticMarkup(createElement(Drafts, { accountMode: true, initial: [art()], fallback: [{ runId: "r9", sys: "D05-W02", routineName: "x", title: "old preview", line: "l" }], anyOn: true, onOpenRoutine: noop }));
    expect(withArt).toContain('data-testid="draft-card"');
    expect(withArt).not.toContain("old preview");
    const rows = renderToStaticMarkup(createElement(Drafts, { accountMode: true, initial: [], fallback: [{ runId: "r9", sys: "D05-W02", routineName: "x", title: "old preview", line: "l" }], anyOn: true, onOpenRoutine: noop }));
    expect(rows).toContain('data-testid="draft-row"');
    expect(rows).toContain("old preview");
    const empty = renderToStaticMarkup(createElement(Drafts, { accountMode: true, initial: [], anyOn: false, onOpenRoutine: noop }));
    expect(empty).toContain('data-testid="no-drafts"');
    expect(empty).toContain("Turn on your first routine");
    const loading = renderToStaticMarkup(createElement(Drafts, { accountMode: true, anyOn: false, onOpenRoutine: noop }));
    expect(loading).toContain('data-testid="drafts-loading"');
  });
});

describe("Home (accounts mode) — What I drafted is the real artifact list", () => {
  const liveList = (over: Partial<LiveApprovals> = {}): LiveApprovals => ({ active: true, loading: false, error: null, approvals: [], pendingCount: 0, receipts: [], drafts: [], refresh: noop, ...over });
  const S: PlatformState = { ...initialState, onboarded: true, view: "today" };
  it("renders the artifact card above the fold with its title", () => {
    const html = renderToStaticMarkup(createElement(HomeView, { V: derive(S, noop), accountMode: true, live: liveList(), artifactsInitial: [art()], briefInitial: null }));
    expect(html).toContain('data-testid="what-i-drafted"');
    expect(html).toContain('data-testid="draft-card"');
    expect(html).toContain("3 founder posts: why we ship from Auckland");
  });
});

describe("RunNowPanel", () => {
  it("names the waiting states honestly", () => {
    expect(runStatusHeading("waiting_input")).toBe("I need something from you");
    expect(runStatusHeading("done")).toBe("Dry run complete");
    expect(runStatusHeading("failed")).toBe("Run failed closed");
  });
});
