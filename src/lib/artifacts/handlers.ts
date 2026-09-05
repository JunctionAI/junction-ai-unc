/* Artifacts — the founder's side of "What I drafted": listing, opening, and the decision loop
   (Approve / Hold / edit / Why) that writes a taste_event and a memory so Unc learns what gets
   through. Store-agnostic (MemoryStore in demo, SupabaseStore otherwise); the memory needs a
   service-role client and is skipped without one. Sending on a channel lives in the API route
   (it needs the channels adapters). */

import { addMemory } from "../brain/memory";
import type { DbClient } from "../db/types";
import { ALL_SYSTEMS } from "../platform/catalog";
import { newId } from "../runtime/context";
import type { Store } from "../runtime/store/interface";
import type { Artifact, ArtifactStatus, Receipt, TasteAction } from "../runtime/types";
import { firstLines } from "./markdown";
import { assertRuntimeContext } from "../db/runtimeContext";
import { contextMemoryDb } from "../db/contextGeneration";
import { rowToArtifact, rowToReceipt } from "../runtime/store/supabase";
import type { Row } from "../db/types";

export interface ArtifactView {
  accountId?: string;
  contextGeneration?: number;
  revision?: number;
  id: string;
  runId: string;
  routineId: string;
  routineName: string;
  category: string;
  kind: Artifact["kind"];
  title: string;
  body: string;
  editedBody: string | null;
  items: Artifact["items"];
  meta: Record<string, unknown>;
  evidence: Artifact["evidence"];
  status: ArtifactStatus;
  preview: string;
  createdAt: string;
}

const catalogById = new Map(ALL_SYSTEMS.map((s) => [s.id, s]));

export function artifactView(a: Artifact, contextGeneration?: number): ArtifactView {
  const def = catalogById.get(a.routineId);
  return {
    accountId: a.accountId,
    contextGeneration,
    revision: a.revision ?? 0,
    id: a.id,
    runId: a.runId,
    routineId: a.routineId,
    routineName: def?.name ?? a.routineId,
    category: def?.cat ?? "",
    kind: a.kind,
    title: a.title,
    body: a.body,
    editedBody: a.editedBody ?? null,
    items: a.items,
    meta: a.meta,
    evidence: a.evidence,
    status: a.status,
    preview: firstLines(a.editedBody ?? a.body),
    createdAt: a.createdAt,
  };
}

export interface ArtifactsDeps {
  contextGeneration?: number;
  store: Store;
  /** Service-role client for the memory; null = no memory (demo). */
  db?: DbClient | null;
  now?: () => Date;
}

export const RECENT_ARTIFACTS = 12;

export async function listArtifactsForAccount(deps: ArtifactsDeps, accountId: string, opts: { routineId?: string; limit?: number } = {}): Promise<ArtifactView[]> {
  const rows = await deps.store.listArtifacts(accountId, { contextGeneration: deps.contextGeneration, routineId: opts.routineId, limit: opts.limit ?? RECENT_ARTIFACTS });
  return rows.map(a => artifactView(a, deps.contextGeneration));
}

export async function getArtifactForAccount(deps: ArtifactsDeps, accountId: string | null, artifactId: string): Promise<ArtifactView | null> {
  const a = await deps.store.getArtifact(artifactId);
  if (!a || (accountId && a.accountId !== accountId)) return null;
  if (deps.contextGeneration !== undefined) {
    const run = await deps.store.getRun(a.runId);
    if (!run || run.accountId !== accountId || (run.contextGeneration ?? 0) !== deps.contextGeneration) return null;
  }
  return artifactView(a, deps.contextGeneration);
}

export type ArtifactAction = "approve" | "hold" | "edit" | "why" | "use";

export interface ArtifactDecision {
  expectedRevision?: number;
  accountId: string | null;
  artifactId: string;
  action: ArtifactAction;
  /** hold: why (becomes the memory); edit: unused. */
  reason?: string;
  /** edit: the new body. */
  editedBody?: string;
  decidedBy?: string;
}

export class ArtifactError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

const STATUS_BY_ACTION: Record<ArtifactAction, ArtifactStatus | null> = { approve: "approved", hold: "held", edit: "edited", why: null, use: "used" };
const TASTE_BY_ACTION: Record<ArtifactAction, TasteAction | null> = { approve: "approved", hold: "held", edit: "edited", why: "why_opened", use: null };

const KIND_WORDS: Record<Artifact["kind"], string> = {
  post: "post",
  post_set: "post set",
  email: "email",
  hook_list: "hook list",
  keyword_list: "keyword list",
  content_gap: "content-gap list",
  lead_brief: "lead brief",
  outreach_draft: "outreach draft",
  meeting_brief: "meeting brief",
  question_list: "question list",
  calendar: "campaign calendar",
  generic: "draft",
};

/** The memory line a decision leaves — the founder's taste, in words Unc can recall. */
export function decisionMemoryText(a: Artifact, action: ArtifactAction, reason?: string): string | null {
  const def = catalogById.get(a.routineId);
  const what = `${KIND_WORDS[a.kind]} from ${def?.name ?? a.routineId} (“${a.title}”)`;
  switch (action) {
    case "approve":
      return `Approved a ${what}.`;
    case "hold":
      return `Held a ${what}${reason ? `: ${reason}` : ""}.`;
    case "edit":
      return `Edited a ${what} before using it — prefers their own wording there.`;
    default:
      return null;
  }
}

export async function decideArtifact(deps: ArtifactsDeps, input: ArtifactDecision): Promise<{ artifact: ArtifactView; memory: string | null; receipt: Receipt }> {
  input = Object.freeze({ ...input });
  const a = await deps.store.getArtifact(input.artifactId);
  if (!a || (input.accountId && a.accountId !== input.accountId)) throw new ArtifactError("not_found", `artifact ${input.artifactId} not found`);
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || undefined;
  if (input.action === "edit" && !(input.editedBody ?? "").trim()) throw new ArtifactError("invalid", "editedBody is required for edit");

  if (deps.db) {
    if (deps.contextGeneration === undefined || !input.decidedBy || input.expectedRevision === undefined)
      throw new ArtifactError("conflict", "Captured draft context and revision required. Reload this draft.");
    const identity = { accountId: a.accountId, contextGeneration: deps.contextGeneration };
    await assertRuntimeContext(deps.db, identity);
    const result = await deps.db.rpc("decide_context_artifact", {
      acct: a.accountId, generation: deps.contextGeneration, actor: input.decidedBy, artifact_id: a.id,
      expected_revision: input.expectedRevision, decision: input.action, reason: reason ?? null,
      edited_body: input.action === "edit" ? input.editedBody!.trim().slice(0, 12_000) : null,
    });
    if (result.error) throw new ArtifactError(result.error.code === "P0002" ? "not_found" : "conflict", result.error.message);
    const data = result.data as { artifact: Row; receipt: Row };
    const text = decisionMemoryText(a, input.action, reason);
    let memory: string | null = null;
    if (text) {
      try {
        await addMemory(contextMemoryDb(deps.db, a.accountId, deps.contextGeneration), {
          accountId: a.accountId, kind: "decision", text, source: "receipt", sourceRef: `artifact:${a.id}:${input.action}`,
          confidence: 0.9, importance: input.action === "hold" ? 4 : 3, tags: ["artifact", a.kind, a.routineId],
        }, { now: deps.now });
        memory = text;
      } catch { /* Atomic decision/receipt stands; no rebased memory on reset. */ }
    }
    await assertRuntimeContext(deps.db, identity, { allowPaused: true });
    return { artifact: artifactView(rowToArtifact(data.artifact), deps.contextGeneration), receipt: rowToReceipt(data.receipt), memory };
  }

  const patch: Partial<Pick<Artifact, "status" | "editedBody">> = {};
  const status = STATUS_BY_ACTION[input.action];
  if (status) patch.status = status;
  if (input.action === "edit") patch.editedBody = input.editedBody!.trim().slice(0, 12_000);
  let updated = a;
  if (Object.keys(patch).length) {
    try {
      // Compare against the version we inspected. Two browser tabs may both decide a draft,
      // but only the first state transition is allowed to win.
      updated = await deps.store.updateArtifact(a.id, patch, a.status);
    } catch (error) {
      if (/changed from/.test(error instanceof Error ? error.message : String(error))) throw new ArtifactError("conflict", "This draft changed while you were reviewing it. Refresh before deciding again.");
      throw error;
    }
  }

  const taste = TASTE_BY_ACTION[input.action];
  if (taste) {
    await deps.store.appendTasteEvent({
      id: newId(),
      accountId: a.accountId,
      routineId: a.routineId,
      action: taste,
      context: { artifactId: a.id, runId: a.runId, kind: a.kind, title: a.title, reason: reason ?? null, decidedBy: input.decidedBy ?? null },
      createdAt: now,
    });
  }
  const receipt: Receipt = {
    id: newId(),
    accountId: a.accountId,
    runId: a.runId,
    kind: "notification",
    description:
      input.action === "approve"
        ? `Approved draft: ${a.title}.`
        : input.action === "hold"
          ? `Held draft: ${a.title} — nothing was sent or published.`
          : input.action === "edit"
            ? `Edited draft: ${a.title}; the original was retained.`
            : input.action === "use"
              ? `Marked draft as used: ${a.title}.`
              : `Opened the evidence for draft: ${a.title}.`,
    payload: {
      artifactDecision: true,
      artifactId: a.id,
      action: input.action,
      fromStatus: a.status,
      toStatus: updated.status,
      reason: reason ?? null,
      decidedBy: input.decidedBy ?? null,
    },
    createdAt: now,
  };
  await deps.store.appendReceipt(receipt);
  return { artifact: artifactView(updated), memory: null, receipt };
}
