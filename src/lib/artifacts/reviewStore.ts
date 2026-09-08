import { z } from "zod";
import type { DbClient } from "../db/types";
import { reviewCommentSchema } from "./reviewContract";

/** The RPC locks membership, context and output; comment and revision job commit together.
 * Not released until its migration has passed database verification. */
export async function saveReviewComment(db: DbClient, identity: {
  accountId: string; userId: string; contextGeneration: number;
}, input: unknown) {
  const comment = reviewCommentSchema.parse(input);
  if (comment.output.accountId !== identity.accountId) throw new Error("Output unavailable in this account");
  const result = await db.rpc("add_review_comment", {
    acct: identity.accountId, generation: identity.contextGeneration, actor: identity.userId,
    artifact: comment.output.artifactId, output: comment.output.outputId,
    expected_revision: comment.output.revision, comment: comment.id,
    anchor_value: comment.anchor, note_value: comment.text, intent_value: comment.intent,
  });
  if (result.error) throw new Error(result.error.code === "40001" ? "Output changed; reload before commenting" : "Could not save comment");
  const saved = z.object({commentId:z.uuid(),jobId:z.uuid().nullable(),duplicate:z.boolean()}).strict().parse(result.data);
  if (saved.commentId !== comment.id || (comment.intent === "change_output") !== (saved.jobId !== null))
    throw new Error("Could not verify saved comment");
  return saved;
}
