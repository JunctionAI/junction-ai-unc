import type { ActionContext } from "../types";
import { DEFAULT_META_PRESET } from "../presets";

export const NOW = new Date("2026-09-03T07:00:00.000Z");

export function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    accountId: "acct-1",
    runId: "run-1",
    routineId: "D02-W01",
    mode: "dry_run",
    currency: "NZD",
    caps: { currency: "NZD", perDay: 100, perMonth: 3000 },
    preset: DEFAULT_META_PRESET,
    spendCeiling: null,
    credential: { kind: "meta_ads", adAccountId: "123456789012345", accessToken: "EAAB-secret-token" },
    now: NOW,
    ...overrides,
  };
}

/** A fetch stub answering canned JSON with optional headers; records every call. */
export function fakeFetch(answers: { status?: number; json?: unknown; headers?: Record<string, string> }[] | ((url: string, init?: RequestInit) => { status?: number; json?: unknown; headers?: Record<string, string> })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const a = typeof answers === "function" ? answers(u, init) : answers[Math.min(i++, answers.length - 1)];
    const status = a.status ?? 200;
    const headers = new Headers(a.headers ?? {});
    return { ok: status >= 200 && status < 300, status, headers, json: async () => a.json ?? {} } as unknown as Response;
  }) as typeof fetch;
  return { fetch: f, calls };
}
