/* A connector looks connected only after a real sync answered.

   status=connected with last_sync_result null is still in-flight (OAuth/token sealed,
   first read not back) — that must not read as Connected, must not unlock routines, and
   Unc must not speak as if the platform is live. ok = asked and got rows; empty = asked
   and the platform said nothing happened. Both are a real sync. error:* is not. */

export function connectorHasRealSync(status: string, lastSyncResult: string | null | undefined): boolean {
  return status === "connected" && (lastSyncResult === "ok" || lastSyncResult === "empty");
}
