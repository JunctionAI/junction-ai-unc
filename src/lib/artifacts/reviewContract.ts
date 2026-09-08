/** Shared, client-safe review contract. Persistence and authorization stay server-side. */
import { z } from "zod";

const id = z.uuid();
const revision = z.number().int().nonnegative();
export const outputRefSchema = z.object({
  accountId: id, artifactId: id, outputId: id, revision,
}).strict();
export const anchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whole") }).strict(),
  z.object({ kind: z.literal("visual"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal("section"), sectionId: z.string().trim().min(1).max(120) }).strict(),
  z.object({ kind: z.literal("video"), seconds: z.number().finite().nonnegative() }).strict(),
]);
export const reviewCommentSchema = z.object({
  id, output: outputRefSchema, anchor: anchorSchema,
  text: z.string().trim().min(1).max(4000),
  intent: z.enum(["change_output", "suggest_brand_preference"]),
}).strict();
export const reviewOutputSchema = z.object({
  ref: outputRefSchema,
  kind: z.enum(["email", "sms", "image", "video", "article", "outreach", "decision", "brief"]),
  sectionIds: z.array(z.string().trim().min(1).max(120)).max(200),
  durationSeconds: z.number().finite().positive().nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sectionIds).size !== value.sectionIds.length)
    ctx.addIssue({ code: "custom", message: "Duplicate section IDs" });
  if (value.kind !== "video" && value.durationSeconds !== null)
    ctx.addIssue({ code: "custom", message: "Only video has a duration" });
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export function sameOutput(a: z.infer<typeof outputRefSchema>, b: z.infer<typeof outputRefSchema>) {
  return a.accountId === b.accountId && a.artifactId === b.artifactId && a.outputId === b.outputId && a.revision === b.revision;
}
/** Caller must derive account identity from its authenticated session, not request JSON. */
export function validateComment(input: unknown, current: ReviewOutput, authenticatedAccountId: string): ReviewComment {
  const output = reviewOutputSchema.parse(current), comment = reviewCommentSchema.parse(input);
  if (output.ref.accountId !== authenticatedAccountId || !sameOutput(comment.output, output.ref))
    throw new Error("Output changed or is unavailable in this account");
  const anchor = comment.anchor;
  if (anchor.kind === "visual" && !["image", "email"].includes(output.kind)) throw new Error("Visual anchor unsupported");
  if (anchor.kind === "section" && !output.sectionIds.includes(anchor.sectionId)) throw new Error("Section unavailable");
  if (anchor.kind === "video" && (output.kind !== "video" || output.durationSeconds === null || anchor.seconds > output.durationSeconds))
    throw new Error("Video timestamp unavailable");
  return comment;
}

/** Brand suggestions never silently become approved memory. */
export function commentEffect(comment: ReviewComment) {
  return comment.intent === "change_output" ? "queue_revision" as const : "request_preference_confirmation" as const;
}
export const outputApprovalSchema = z.object({
  output: outputRefSchema, actorId: id,
  action: z.enum(["prepare_provider_draft", "send", "publish", "change_ads"]),
  targetId: z.string().trim().min(1).max(200),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
/** Pure scope check only: execution additionally requires live membership, policy and provider checks. */
export function approvalMatches(input: unknown, current: ReviewOutput, action: string, targetId: string, now: number): boolean {
  const parsed = outputApprovalSchema.safeParse(input);
  return parsed.success && Number.isFinite(now) && sameOutput(parsed.data.output, current.ref) &&
    parsed.data.action === action && parsed.data.targetId === targetId && Date.parse(parsed.data.expiresAt) > now;
}
