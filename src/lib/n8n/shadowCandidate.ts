/** Private recovery checkpoint, NOT a verified or customer-visible artifact. */
import { EVIDENCE_MAX, validateArtifactObject } from "../artifacts/validate";
import type { ArtifactDraft, N8nCallResult } from "../runtime/types";

export interface ShadowCandidate {
  artifact: ArtifactDraft;
  executionReceipt: Record<string, unknown>;
}

export function shadowCandidate(artifact: unknown, reportedReceipt: Record<string, unknown>): ShadowCandidate {
  const parsed = validateArtifactObject(artifact, { kind: "keyword_list", maxItems: 15, allowedNumbers: null });
  if (!parsed.ok) throw new Error("Shadow recovery artifact is invalid");
  // Only the validated business artifact/receipt survives. No raw envelope, request
  // headers, data bearer, API response or root artifact metadata is checkpointed.
  const candidate = { artifact: { ...parsed.artifact, meta: {} }, executionReceipt: reportedReceipt };
  if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 256_000) throw new Error("Shadow recovery artifact is too large");
  return candidate;
}

export function verifiedShadowResult(candidate: ShadowCandidate, receipt: Record<string, unknown>): Extract<N8nCallResult, { kind: "artifact" }> {
  return { kind: "artifact", artifact: { ...candidate.artifact,
    meta: { executionReceipt: receipt, approval_status: "pending_approval", executed_action: "none" },
    evidence: [...(candidate.artifact.evidence ?? []).slice(0, EVIDENCE_MAX - 1), { source: "n8n_execution",
      ref: `https://junctionai8.app.n8n.cloud/workflow/${receipt.workflowId}/executions/${receipt.executionId}` }],
  } };
}
