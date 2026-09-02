/* Process-wide Store for the app's API routes and the worker CLI.

   Today: MemoryStore. Runs, receipts, approvals and routine states live in
   this process's memory and DO NOT survive a restart (and are not shared
   between the Next server and the worker daemon, which are separate
   processes). Good enough to exercise dry runs end to end.

   TODO(supabase): swap the constructor below for the SupabaseStore in
   ./supabase.ts (built separately) — same Store interface, persistent, shared
   by the app and the worker. Do not import it here until it lands; nothing
   else needs to change. The globalThis cache keeps one instance across
   Next's per-route module graphs (the usual singleton pattern for db clients). */

import type { Store } from "./interface";
import { MemoryStore } from "./memory";

const g = globalThis as typeof globalThis & { __uncRuntimeStore?: Store };

export function getStore(): Store {
  if (!g.__uncRuntimeStore) g.__uncRuntimeStore = new MemoryStore();
  return g.__uncRuntimeStore;
}

/** Tests only: replace the process-wide store. */
export function setStoreForTests(store: Store | undefined): void {
  g.__uncRuntimeStore = store;
}
