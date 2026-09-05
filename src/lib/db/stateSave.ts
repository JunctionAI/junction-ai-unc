/* Browser-safe save protocol. A retry reuses the exact payload and save ID after a
   lost response; it never refreshes a stale revision and overwrites another writer. */
import type { PlatformState } from "../platform/state";
import { persistedProjection, stateToRows } from "./mapping";

export const STATE_CONFLICT_MESSAGE = "This business was updated elsewhere. Your edits were not saved. Copy any edits you need, then reload to use the latest version.";
export const STATE_SAVE_MAX_BYTES = 1_000_000;

export function stateSaveRows(accountId: string, state: PlatformState) {
  const rows = stateToRows(accountId, state);
  return { account: rows.account, goals: rows.goals, resourceProfile: rows.resourceProfile, teamMembers: rows.teamMembers,
    plan: rows.plan, businessProfile: rows.businessProfile, chatMessages: rows.chatMessages, stateMeta: rows.stateMeta };
}

export function createAccountStateSaver(accountId: string, initialRevision: number, opts: { fetch?: typeof fetch; id?: () => string; initialState?: PlatformState } = {}) {
  let revision = initialRevision;
  let acknowledgedProjection = opts.initialState ? persistedProjection(opts.initialState) : null;
  let pending: { body: string; projection: string } | null = null;
  let inFlight = false;
  const request = opts.fetch ?? fetch;
  const id = opts.id ?? (() => crypto.randomUUID());
  return {
    get revision() { return revision; },
    async save(state: PlatformState): Promise<void> {
      if (inFlight) throw new Error("A save is already running.");
      inFlight = true;
      try {
        const projection = persistedProjection(state);
        // Hydration is already persisted. Opening another tab must not bump revision.
        // Never skip an uncertain in-flight payload, even if the user reverted edits.
        if (!pending && projection === acknowledgedProjection) return;
        // Flush an uncertain earlier save first. Only then send newer local edits
        // against the newly acknowledged revision. A conflict stays a conflict.
        do {
          pending ??= { projection, body: JSON.stringify({ accountId, revision, saveId: id(), rows: stateSaveRows(accountId, state) }) };
          if (new TextEncoder().encode(pending.body).byteLength > STATE_SAVE_MAX_BYTES) throw new Error("This account draft is too large to save. Please contact support.");
          const response = await request("/api/account/state", { method: "PUT", credentials: "same-origin",
            headers: { "content-type": "application/json", "x-unc-account-save": "1" }, body: pending.body });
          if (response.status === 409) throw new Error(STATE_CONFLICT_MESSAGE);
          if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Sign in again before saving." : "Couldn't save your account. Your edits are still here; try again.");
          const result = await response.json() as { ok?: boolean; accountId?: string; revision?: number };
          if (result.ok !== true || result.accountId !== accountId || !Number.isSafeInteger(result.revision) || result.revision !== revision + 1)
            throw new Error("The account save could not be verified. Please try again.");
          revision = result.revision;
          const savedProjection = pending.projection;
          acknowledgedProjection = savedProjection;
          pending = null;
          if (savedProjection === projection) break;
        } while (true);
      } finally { inFlight = false; }
    },
  };
}
