/* The registry: every action Unc can propose, by id, plus the prompt-facing description and
   the idempotency key.

   Adding an action = adding it to the platform's list (meta/actions.ts META_ACTIONS) — the
   registry, the prompt block, the executor and the inspector all read from here. */

import { stableHash } from "../runtime/context";
import { META_ACTIONS } from "./meta/actions";
import type { Action, ActionRisk, ParamSpec } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = Action<any, any>;

export const ACTIONS: Readonly<Record<string, AnyAction>> = Object.freeze(Object.fromEntries((META_ACTIONS as readonly AnyAction[]).map((a) => [a.id, a])));

export const ACTION_IDS: readonly string[] = Object.freeze(Object.keys(ACTIONS));

export function getAction(id: string): AnyAction | null {
  return ACTIONS[id] ?? null;
}

export function isActionId(id: unknown): id is string {
  return typeof id === "string" && id in ACTIONS;
}

/** Every risk class an action carries (primary + secondary). */
export function risksOf(action: Pick<AnyAction, "risk" | "secondaryRisks">): ActionRisk[] {
  return [action.risk, ...(action.secondaryRisks ?? [])];
}

/** The action's declared params only — a decision's extra keys (actionId, labels) never reach a request. */
export function pickDeclaredParams(action: AnyAction, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(action.params.properties)) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

/** Per (runId, actionId, params): the same proposal executed twice yields the same key, and the
    executor's ledger refuses the second. Params are hashed key-sorted so ordering is irrelevant. */
export function idempotencyKey(runId: string, actionId: string, params: Record<string, unknown>): string {
  return `${runId}:${actionId}:${stableHash(params)}`;
}

// ---------- prompt block ----------

function describeParam(name: string, spec: ParamSpec): string {
  const bits = [spec.type + (spec.enum ? ` (${spec.enum.join(" | ")})` : "")];
  if (spec.required) bits.push("required");
  return `${name}: ${bits.join(", ")} — ${spec.description}`;
}

/** One entry per action, for Unc's DECIDE prompt: what it may propose, what each needs and
    what it risks. `ids` narrows the block to the actions a routine's options reference. */
export function describeActionsForPrompt(ids?: readonly string[]): string {
  const list = (ids ?? ACTION_IDS).map((id) => ACTIONS[id]).filter(Boolean);
  if (!list.length) return "";
  const lines = list.map((a) => {
    const params = Object.entries(a.params.properties).map(([k, s]) => `    ${describeParam(k, s)}`);
    return `- ${a.id} [${risksOf(a).join("+")}] — ${a.title}: ${a.description}\n${params.join("\n")}`;
  });
  return `ACTIONS YOU MAY PROPOSE (each runs only after the founder approves; dry-run shows the exact request first):\n${lines.join("\n")}`;
}
