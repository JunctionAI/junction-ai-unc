/* GET /api/connectors/state — what the Connectors grid needs in accounts mode, from the
   database: every card's real row (status, what it reads, when it was last read and how it
   went), whether the OAuth app for it is configured, whether a token path exists, and the
   caller's role (the token path is owner-only). No token value, ever. */

import type { HandlerDeps } from "./handlers";
import { unwrap } from "../db/types";
import { hasTokenPath } from "./manualFields";
import { authProviderFor, isPlatformConnectable } from "./providers/index";
import { CONNECTOR_REGISTRY, GOOGLE_CHILDREN, GOOGLE_UMBRELLA, isPlatformConfigured } from "./registry";
import { accountForUser, listConnectors, memberRole, readLastReadMetrics, type ConnectorStatus } from "./store";

export interface ConnectorRecoveryState {
  status: "pending" | "retryable" | "uncertain" | "exhausted";
  attempts: number;
  retryAt: string | null;
}

export interface ConnectorStateView {
  platform: string;
  /** Card name (connState key). */
  name: string;
  status: ConnectorStatus | "disconnected";
  externalRef: string | null;
  lastSyncAt: string | null;
  /** ok | empty | error:<code> | null (never read). */
  lastSyncResult: string | null;
  /** KPI metrics the last read wrote (0011); null when unknown. */
  lastReadMetrics: number | null;
  /** The OAuth app's client id + secret are present (or a hosted auth provider is configured for it — PROTOTYPE) → Connect is the primary path. */
  oauthConfigured: boolean;
  /** Which path Connect takes: our own app, or a hosted provider (only when set). */
  authProvider?: "composio" | "nango";
  /** An owner can paste a key for it. */
  tokenPath: boolean;
  /** Redacted recovery state for this grant and account generation only. */
  authRecovery?: ConnectorRecoveryState;
}

export interface ConnectorsStateListing {
  role: "owner" | "member";
  connectors: ConnectorStateView[];
  /** "Connect Google": one consent for the three children when the Google app is configured. */
  google: { configured: boolean; children: string[] };
}

export type ConnectorsStateResult = { status: 200; body: ConnectorsStateListing } | { status: 200; body: { fallback: true; reason: "accounts_not_configured" } } | { status: 401 | 403; body: { error: string } };

function providerMarker(platform: string, deps: HandlerDeps): { authProvider?: "composio" | "nango" } {
  const r = authProviderFor(platform, { env: deps.config.env, fetch: deps.fetch });
  return r.mode !== "own" && r.provider ? { authProvider: r.mode } : {};
}

export async function handleConnectorsState(deps: HandlerDeps): Promise<ConnectorsStateResult> {
  if (!deps.config.dbConfigured || !deps.db) return { status: 200, body: { fallback: true, reason: "accounts_not_configured" } };
  if (!deps.userId) return { status: 401, body: { error: "sign in first" } };
  const accountId = await accountForUser(deps.db, deps.userId);
  if (!accountId) return { status: 403, body: { error: "no account for this user" } };
  const role = await memberRole(deps.db, deps.userId, accountId);
  if (!role) return { status: 403, body: { error: "account membership required" } };
  const [rows, metrics, recovery] = await Promise.all([listConnectors(deps.db, accountId), readLastReadMetrics(deps.db, accountId),
    unwrap<(ConnectorRecoveryState & { connectorId: string })[] | null>("connector.recovery.state", deps.db.rpc("connector_recovery_state", { p_account: accountId, p_actor: deps.userId })),
  ]);
  if (!recovery) return { status: 403, body: { error: "account membership required" } };
  const recoveryById = new Map(recovery.map(({ connectorId, status, attempts, retryAt }) => [connectorId, { status, attempts, retryAt }]));
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  const connectors: ConnectorStateView[] = CONNECTOR_REGISTRY.map((e) => {
    const r = byPlatform.get(e.id);
    return {
      platform: e.id,
      name: e.name,
      status: r?.status ?? "disconnected",
      externalRef: r?.external_ref ?? null,
      lastSyncAt: r?.last_sync_at ?? null,
      lastSyncResult: r?.last_sync_result ?? null,
      lastReadMetrics: r ? (metrics[r.id] ?? null) : null,
      oauthConfigured: isPlatformConnectable(e.id, { env: deps.config.env, fetch: deps.fetch }),
      tokenPath: hasTokenPath(e.id),
      ...(r && recoveryById.has(r.id) ? { authRecovery: recoveryById.get(r.id)! } : {}),
      ...providerMarker(e.id, deps),
    };
  });
  return { status: 200, body: { role, connectors, google: { configured: isPlatformConfigured(GOOGLE_UMBRELLA.id, deps.config.env), children: [...GOOGLE_CHILDREN] } } };
}
