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
import type { Artifact, ArtifactStatus, TasteAction } from "../runtime/types";
import { firstLines } from "./markdown";

export interface ArtifactView {
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

export function artifactView(a: Artifact): ArtifactView {
  const def = catalogById.get(a.routineId);
  return {
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
  store: Store;
  /** Service-role client for the memory; null = no memory (demo). */
  db?: DbClient | null;
  now?: () => Date;
}

export const RECENT_ARTIFACTS = 12;

export async function listArtifactsForAccount(deps: ArtifactsDeps, accountId: string, opts: { routineId?: string; limit?: number } = {}): Promise<ArtifactView[]> {
  const rows = await deps.store.listArtifacts(accountId, { routineId: opts.routineId, limit: opts.limit ?? RECENT_ARTIFACTS });
  return rows.map(artifactView);
}

export async function getArtifactForAccount(deps: ArtifactsDeps, accountId: string | null, artifactId: string): Promise<ArtifactView | null> {
  const a = await deps.store.getArtifact(artifactId);
  if (!a || (accountId && a.accountId !== accountId)) return null;
  return artifactView(a);
}

export type ArtifactAction = "approve" | "hold" | "edit" | "why" | "use";

export interface ArtifactDecision {
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
    readonly code: "not_found" | "invalid",
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

export async function decideArtifact(deps: ArtifactsDeps, input: ArtifactDecision): Promise<{ artifact: ArtifactView; memory: string | null }> {
  const a = await deps.store.getArtifact(input.artifactId);
  if (!a || (input.accountId && a.accountId !== input.accountId)) throw new ArtifactError("not_found", `artifact ${input.artifactId} not found`);
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || undefined;
  if (input.action === "edit" && !(input.editedBody ?? "").trim()) throw new ArtifactError("invalid", "editedBody is required for edit");

  const patch: Partial<Pick<Artifact, "status" | "editedBody">> = {};
  const status = STATUS_BY_ACTION[input.action];
  if (status) patch.status = status;
  if (input.action === "edit") patch.editedBody = input.editedBody!.trim().slice(0, 12_000);
  const updated = Object.keys(patch).length ? await deps.store.updateArtifact(a.id, patch) : a;

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
  let memory: string | null = null;
  const text = decisionMemoryText(a, input.action, reason);
  if (text && deps.db) {
    try {
      await addMemory(deps.db, { accountId: a.accountId, kind: "decision", text, source: "receipt", sourceRef: `artifact:${a.id}:${input.action}`, confidence: 0.9, importance: input.action === "hold" ? 4 : 3, tags: ["artifact", a.kind, a.routineId] }, { now: deps.now });
      memory = text;
    } catch {
      memory = null; // the decision stands without the memory
    }
  }
  return { artifact: artifactView(updated), memory };
}
