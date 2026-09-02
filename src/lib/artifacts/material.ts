/* The material a producer (or an n8n workflow) gets: the run's reads compacted to a size a
   prompt can carry, and the SkillContext built from a run + what the context source found.
   Pure; relative imports only. */

import type { PriorArtifact, SkillContext, SkillGoal, SkillProfile } from "../runtime/skills/types";
import type { Artifact, ReadResult, RunContext } from "../runtime/types";

export const READS_MAX_CHARS = 7000;
export const SAMPLE_ROWS = 8;
export const CELL_MAX_CHARS = 300;

export interface CompactRead {
  count: number;
  provenance: string;
  metrics: Record<string, number | string | boolean | null>;
  sample: Record<string, unknown>[];
}

function trimCell(v: unknown): unknown {
  if (typeof v === "string") return v.length > CELL_MAX_CHARS ? `${v.slice(0, CELL_MAX_CHARS)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 10).map(trimCell);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 12).map(([k, x]) => [k, trimCell(x)]));
  return v;
}

/** Every read as { count, provenance, metrics, sample } inside a total char budget (the sample
    shrinks first, alias by alias, until it fits). */
export function compactReads(reads: Record<string, ReadResult>, maxChars = READS_MAX_CHARS): Record<string, CompactRead> {
  const out: Record<string, CompactRead> = {};
  for (const [as, r] of Object.entries(reads)) {
    out[as] = { count: r.rows.length, provenance: r.provenance ?? "ok", metrics: r.metrics, sample: r.rows.slice(0, SAMPLE_ROWS).map((row) => trimCell(row) as Record<string, unknown>) };
  }
  let n = SAMPLE_ROWS;
  while (JSON.stringify(out).length > maxChars && n > 0) {
    n--;
    for (const c of Object.values(out)) c.sample = c.sample.slice(0, n);
  }
  return out;
}

export interface GatheredMaterial {
  profile: SkillProfile | null;
  memories: string[];
  goal: SkillGoal | null;
  plan: SkillContext["plan"];
  priorArtifacts: Artifact[];
  founderNotes: string | null;
}

export function priorArtifactView(a: Artifact): PriorArtifact {
  return { id: a.id, kind: a.kind, routineId: a.routineId, title: a.title, body: (a.editedBody ?? a.body).slice(0, 3000), createdAt: a.createdAt, status: a.status };
}

export function skillContextFrom(ctx: RunContext, m: GatheredMaterial): SkillContext {
  return {
    routineId: ctx.routineId,
    accountId: ctx.account.accountId,
    profile: m.profile,
    memories: m.memories,
    reads: ctx.reads,
    inputs: ctx.inputs ?? {},
    vars: ctx.vars,
    goal: m.goal,
    plan: m.plan,
    priorArtifacts: m.priorArtifacts.map(priorArtifactView),
    founderNotes: m.founderNotes,
    currency: ctx.account.currency,
    today: ctx.startedAt.slice(0, 10),
  };
}
