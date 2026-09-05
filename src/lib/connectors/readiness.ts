import type { ConnectorStateView } from "./state";

/** Presentation of evidence, not an authorization decision or a promised freshness SLA. */
export function connectorEvidence(c: ConnectorStateView): { identity: string; read: string } {
  const identity = c.externalRef ? `account / store: ${c.externalRef}` : "account / store: not selected";
  if (c.lastSyncResult === "error:auth_temporarily_unavailable") return { identity, read: "connection temporarily unavailable — retry later; another login is not currently required." };
  if (c.lastSyncResult === "error:auth_configuration_error") return { identity, read: "connection needs operator attention — another customer login will not repair the configuration." };
  const ms = Date.parse(c.lastSyncAt ?? "");
  const at = Number.isFinite(ms) ? new Date(ms).toISOString().replace("T", " ").replace(".000Z", " UTC") : null;
  if (!at) return { identity, read: "no dated data read yet — connecting alone does not prove data is available." };
  const label = c.lastSyncResult === "ok" ? "last successful read" : c.lastSyncResult === "empty" ? "last read returned no data" : "last read attempt";
  return { identity, read: `${label}: ${at}. this is a snapshot, not a live feed.` };
}
