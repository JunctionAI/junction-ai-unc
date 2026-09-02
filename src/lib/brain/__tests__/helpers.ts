/* Shared fixtures for the brain tests: a schema-checked fake with one account, a
   deterministic "embedder" (hash-bucket vectors so similar texts land near each other),
   and a scripted extract LLM. Nothing here reaches a network or process.env. */

import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { EmbedFn, EmbedResult } from "@/lib/llm/embed";
import { EMBEDDING_DIM } from "@/lib/llm/embed";
import type { ExtractLlm } from "../extract";

export const ACCT = "00000000-0000-4000-8000-00000000acc1";
export const OTHER = "00000000-0000-4000-8000-00000000acc2";

export function brainDb(): FakeSupabase {
  const db = new FakeSupabase();
  db.seed("accounts", [
    { id: ACCT, name: "Example Co" },
    { id: OTHER, name: "Someone Else" },
  ]);
  return db;
}

/** A fixed clock that ticks 1 s per call so created_at ordering is deterministic. */
export function clock(start = "2026-09-02T09:00:00.000Z") {
  let t = new Date(start).getTime();
  return {
    now: () => new Date((t += 1000)),
    at: () => new Date(t),
  };
}

/** Bag-of-words embedding: each word hashes to a dimension. Same words ⇒ same direction. */
export function toyVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const w of text.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619) >>> 0;
    v[h % EMBEDDING_DIM] += 1;
  }
  return v;
}

export function toyEmbed(): EmbedFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (texts: string[]): Promise<EmbedResult> => {
    calls.push(texts);
    return { vectors: texts.map((t) => (t.trim() ? toyVector(t) : null)), ok: true, usage: { input: texts.length * 5, output: 0 }, latencyMs: 1, model: "toy" };
  }) as EmbedFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

/** An extract LLM that returns the given JSON (object or string) and records prompts. */
export function scriptedLlm(reply: unknown | null): ExtractLlm & { prompts: { system: string; user: string; accountId: string }[] } {
  const prompts: { system: string; user: string; accountId: string }[] = [];
  return {
    prompts,
    async complete(p) {
      prompts.push(p);
      if (reply === null) return null;
      return typeof reply === "string" ? reply : JSON.stringify(reply);
    },
  };
}
