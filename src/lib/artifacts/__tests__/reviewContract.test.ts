import { describe, expect, it } from "vitest";
import { approvalMatches, commentEffect, reviewOutputSchema, validateComment, type ReviewOutput } from "../reviewContract";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const output: ReviewOutput = { ref: { accountId: id, artifactId: id, outputId: id, revision: 1 }, kind: "email", sectionIds: ["hero"], durationSeconds: null };
const comment = { id, output: output.ref, anchor: { kind: "visual", x: .25, y: .75 }, text: "More editorial", intent: "change_output" };
describe("versioned review contract", () => {
  it("keeps normalized anchors and queues an output revision only", () => {
    const parsed = validateComment(comment, output, id);
    expect(parsed.anchor).toEqual(comment.anchor); expect(commentEffect(parsed)).toBe("queue_revision");
  });
  it("requires separate confirmation for brand preferences", () => {
    expect(commentEffect(validateComment({ ...comment, intent: "suggest_brand_preference" }, output, id))).toBe("request_preference_confirmation");
  });
  it.each(["accountId", "artifactId", "outputId"])("refuses mismatched %s", key => {
    expect(() => validateComment({ ...comment, output: { ...output.ref, [key]: other } }, output, id)).toThrow();
  });
  it("refuses foreign session and stale versions", () => {
    expect(() => validateComment(comment, output, other)).toThrow();
    expect(() => validateComment(comment, { ...output, ref: { ...output.ref, revision: 2 } }, id)).toThrow();
  });
  it.each([-0.01, 1.01, Infinity, NaN])("refuses invalid coordinate %s", x => {
    expect(() => validateComment({ ...comment, anchor: { kind: "visual", x, y: .5 } }, output, id)).toThrow();
  });
  it("binds sections to real output components", () => {
    expect(validateComment({ ...comment, anchor: { kind: "section", sectionId: "hero" } }, output, id)).toBeTruthy();
    expect(() => validateComment({ ...comment, anchor: { kind: "section", sectionId: "missing" } }, output, id)).toThrow();
    expect(reviewOutputSchema.safeParse({ ...output, sectionIds: ["hero", "hero"] }).success).toBe(false);
  });
  it("checks actual video duration", () => {
    const video = { ...output, kind: "video" as const, durationSeconds: 15 };
    const c = { ...comment, anchor: { kind: "video", seconds: 14 } };
    expect(validateComment(c, video, id)).toBeTruthy();
    expect(() => validateComment(c, output, id)).toThrow();
    expect(() => validateComment({ ...c, anchor: { kind: "video", seconds: 16 } }, video, id)).toThrow();
  });
  it("rejects extra instructions and blank comments", () => {
    expect(() => validateComment({ ...comment, autoSend: true }, output, id)).toThrow();
    expect(() => validateComment({ ...comment, text: " " }, output, id)).toThrow();
  });
  it("approval binds exact output version, action, destination and expiry", () => {
    const approval = { output: output.ref, actorId: id, action: "send", targetId: "test-list", expiresAt: "2026-09-09T01:00:00Z" };
    const now = Date.parse("2026-09-09T00:00:00Z");
    expect(approvalMatches(approval, output, "send", "test-list", now)).toBe(true);
    expect(approvalMatches(approval, output, "publish", "test-list", now)).toBe(false);
    expect(approvalMatches(approval, output, "send", "live-list", now)).toBe(false);
    expect(approvalMatches(approval, { ...output, ref: { ...output.ref, revision: 2 } }, "send", "test-list", now)).toBe(false);
    expect(approvalMatches(approval, output, "send", "test-list", Date.parse(approval.expiresAt))).toBe(false);
  });
});
