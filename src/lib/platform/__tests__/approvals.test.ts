/* ApprovalRecord (as the API's ApprovalView) → the Home card view model, and Unc's outcome
   copy — the demo's exact lines on the happy path, honest lines otherwise. */

import { describe, expect, it } from "vitest";
import type { ApprovalView, DraftView, ReceiptView } from "@/lib/approvals/handlers";
import { approvalCardFields, draftRow, expiryLabel, NOTHING_WAITING_COPY, outcomeCopy, receiptHandle, receiptRow } from "../approvals";

const NOW = new Date("2026-09-02T09:00:00.000Z");
const view = (over: Partial<ApprovalView> = {}): ApprovalView => ({
  id: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
  runId: "run-1",
  routineId: "D02-W01",
  routineName: "Daily paid decisioning",
  category: "Paid ads",
  title: "Shift NZ$40/day into Advantage+ retargeting",
  detail: "Prospecting-B ROAS fell to 1.4× over 7 days; retargeting holds 3.1×.",
  before: "NZ$60/day Prospecting-B",
  after: "NZ$20/day + NZ$40 retargeting",
  reasoning: "Certified 7-day ROAS: Prospecting-B 1.4×, Advantage+ 3.1×.",
  status: "pending",
  expiresAt: "2026-09-03T03:00:00.000Z",
  createdAt: "2026-09-02T07:00:00.000Z",
  decidedAt: null,
  ...over,
});

describe("expiryLabel", () => {
  it("reads like the demo cards: hours under 48h, days from 48h, minutes under an hour, expired past due", () => {
    expect(expiryLabel("2026-09-03T03:00:00.000Z", NOW)).toBe("expires in 18h");
    expect(expiryLabel("2026-09-04T09:00:00.000Z", NOW)).toBe("expires in 2d"); // the default 48h gate
    expect(expiryLabel("2026-09-05T09:00:00.000Z", NOW)).toBe("expires in 3d");
    expect(expiryLabel("2026-09-02T09:40:00.000Z", NOW)).toBe("expires in 40m");
    expect(expiryLabel("2026-09-02T09:00:20.000Z", NOW)).toBe("expires in 1m");
    expect(expiryLabel("2026-09-02T08:59:00.000Z", NOW)).toBe("expired");
    expect(expiryLabel("not a date", NOW)).toBe("expired");
  });
});

describe("approvalCardFields", () => {
  it("maps routine tag = routine id, title, detail, before → after, expiry and the reasoning for Why?", () => {
    const f = approvalCardFields(view(), NOW);
    expect(f).toEqual({
      id: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
      sys: "D02-W01",
      title: "Shift NZ$40/day into Advantage+ retargeting",
      detail: "Prospecting-B ROAS fell to 1.4× over 7 days; retargeting holds 3.1×.",
      before: "NZ$60/day Prospecting-B",
      after: "NZ$20/day + NZ$40 retargeting",
      expiry: "expires in 18h",
      whyText: "Certified 7-day ROAS: Prospecting-B 1.4×, Advantage+ 3.1×.",
      expired: false,
    });
  });
  it("never leaves Why? empty, and flags lapsed approvals", () => {
    const f = approvalCardFields(view({ reasoning: "", expiresAt: "2026-09-01T00:00:00.000Z" }), NOW);
    expect(f.whyText).toBe("Proposed by Daily paid decisioning. No further reasoning was recorded for this decision.");
    expect(f.expired).toBe(true);
    expect(f.expiry).toBe("expired");
  });
});

describe("outcomeCopy", () => {
  it("held → the demo's held line", () => {
    expect(outcomeCopy({ decision: "held", runStatus: "skipped", receiptId: "r", error: null })).toBe("Held. I’ll re-surface it tomorrow with fresh numbers — nothing moves meanwhile.");
  });
  it("approved + run continues → the demo's receipt line with the real receipt handle", () => {
    expect(outcomeCopy({ decision: "approved", runStatus: "done", receiptId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b", error: null })).toBe(
      "On it — executing only the approved scope, reading the result back, then receipt 3f2a9c1e lands here.",
    );
  });
  it("approved but the run failed closed → says so, names the reason, promises nothing", () => {
    const t = outcomeCopy({ decision: "approved", runStatus: "failed", receiptId: "abcdef12-0000-0000-0000-000000000000", error: "executor refuses mutations" });
    expect(t).toBe("Approved — but I couldn’t carry it out: executor refuses mutations. Nothing was changed; receipt abcdef12 says so.");
    expect(outcomeCopy({ decision: "approved", runStatus: "skipped", receiptId: null, error: null })).toBe("Approved, but the run had already lapsed — nothing was changed.");
  });
});

describe("rows", () => {
  it("receipt and draft rows carry a short handle / the gate title and one line", () => {
    expect(receiptHandle("3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b")).toBe("3f2a9c1e");
    const r: ReceiptView = { id: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b", runId: "run-1", approvalId: null, kind: "draft", platform: null, description: "Would ask Tom: Draft 3 posts", createdAt: NOW.toISOString() };
    expect(receiptRow(r)).toEqual({ id: r.id, handle: "3f2a9c1e", kind: "draft", text: "Would ask Tom: Draft 3 posts" });
    const d: DraftView = { runId: "run-1", routineId: "D01-W01", routineName: "Founder content engine", title: "Draft 3 posts", detail: "From 12 customer questions.", description: "Would ask Tom: Draft 3 posts", createdAt: NOW.toISOString(), status: "done" };
    expect(draftRow(d)).toEqual({ runId: "run-1", sys: "D01-W01", routineName: "Founder content engine", title: "Draft 3 posts", line: "From 12 customer questions." });
    expect(draftRow({ ...d, detail: "" }).line).toBe("Would ask Tom: Draft 3 posts");
  });
  it("the honest empty line is in Unc's register", () => {
    expect(NOTHING_WAITING_COPY).toBe("Nothing waiting on you right now — I’ll bring the next decision here.");
  });
});
