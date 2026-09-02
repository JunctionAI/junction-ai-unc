/* Process-wide Store for the app's API routes and the worker CLI.

   - Database configured with a service-role key → SupabaseStore: persistent and
     shared by the Next server and the worker daemon (the worker runs outside any
     user session, so it needs the service role; RLS still protects client access).
   - Otherwise → MemoryStore: runs, receipts, approvals and routine states live in
     this process's memory and DO NOT survive a restart (demo / local mode).

   The globalThis cache keeps one instance across Next's per-route module graphs
   (the usual singleton pattern for db clients). */

import type { Store } from "./interface";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import { asDb } from "@/lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";

const g = globalThis as typeof globalThis & { __uncRuntimeStore?: Store; __uncRuntimeStoreKind?: string };

export function getStore(): Store {
  if (!g.__uncRuntimeStore) {
    if (isServiceRoleConfigured()) {
      g.__uncRuntimeStore = new SupabaseStore(asDb(getServiceSupabase()));
      g.__uncRuntimeStoreKind = "supabase";
    } else {
      g.__uncRuntimeStore = new MemoryStore();
      g.__uncRuntimeStoreKind = "memory";
    }
  }
  return g.__uncRuntimeStore;
}

/** Which backing store the process is using — surfaced in worker logs / health. */
export function storeKind(): "supabase" | "memory" {
  getStore();
  return (g.__uncRuntimeStoreKind as "supabase" | "memory") ?? "memory";
}

/** Tests only: replace the process-wide store. */
export function setStoreForTests(store: Store | undefined): void {
  g.__uncRuntimeStore = store;
  g.__uncRuntimeStoreKind = store ? "test" : undefined;
}
