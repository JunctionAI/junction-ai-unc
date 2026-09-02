/* "Turn it on" from the guided step / Home's "Setting up next": enable the routine server-side
   (POST /api/setup/enable — the Store record the worker reads) then dry-run it right away
   (POST /api/routines/run — the same service the always-on loop uses; zero outward actions).
   The caller flips PlatformState.routineOn too, so the UI and the autosave agree.

   Returns what happened, honestly: the run's status + summary, or the line that failed. */

export interface TurnOnInput {
  routineId: string;
  accountId: string;
  account: { currency: string; budgetMonthly: number };
  fetch?: typeof fetch;
}

export type TurnOnResult =
  | { kind: "ran"; runId: string; status: string; summary: string; drafts: number }
  | { kind: "enabled_only"; error: string }
  | { kind: "fallback" }
  | { kind: "error"; message: string };

type EnableResponse = { enabled?: boolean; fallback?: boolean; error?: string };
type RunResponse = { run?: { runId: string; status: string; summary: string; receipts: { kind: string }[] }; fallback?: boolean; error?: string };

export async function turnOnRoutine(input: TurnOnInput): Promise<TurnOnResult> {
  const f = input.fetch ?? fetch;
  try {
    const en = await f("/api/setup/enable", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routineId: input.routineId }) });
    const enData = (await en.json().catch(() => ({}))) as EnableResponse;
    if (en.ok && enData.fallback) return { kind: "fallback" };
    if (!en.ok || !enData.enabled) return { kind: "error", message: enData.error ?? `couldn’t turn it on (${en.status})` };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
  try {
    const res = await f("/api/routines/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: input.accountId, routineId: input.routineId, account: { currency: input.account.currency, budgetMonthly: input.account.budgetMonthly } }),
    });
    const data = (await res.json().catch(() => ({}))) as RunResponse;
    if (!res.ok || !data.run) return { kind: "enabled_only", error: data.error ?? `the first dry run didn’t start (${res.status})` };
    return { kind: "ran", runId: data.run.runId, status: data.run.status, summary: data.run.summary, drafts: data.run.receipts.filter((r) => r.kind === "draft").length };
  } catch (e) {
    return { kind: "enabled_only", error: e instanceof Error ? e.message : String(e) };
  }
}

/** What the step says once the routine is on, from the real run outcome. */
export function turnOnLine(r: TurnOnResult): string {
  switch (r.kind) {
    case "ran":
      return r.status === "done" && r.drafts > 0
        ? "Running now — your first draft lands in What I drafted."
        : r.status === "skipped"
          ? `On. First dry run found nothing to draft yet — ${r.summary}. The next run is on its schedule.`
          : r.status === "failed"
            ? `On, but the first dry run failed closed — ${r.summary}. Nothing changed; I'll retry on schedule.`
            : "Running now — your first draft lands in What I drafted.";
    case "enabled_only":
      return `On. The first dry run didn't start (${r.error}) — it runs on its schedule instead.`;
    case "fallback":
      return "On (demo — nothing is stored).";
    case "error":
      return `Couldn’t turn it on: ${r.message}`;
  }
}
