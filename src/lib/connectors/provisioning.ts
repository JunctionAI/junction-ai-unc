/* SERVER ONLY — per-tenant sync provisioning (Airbyte Cloud) behind a small interface.

   SyncProvisioner is what the rest of the app talks to. Two implementations:
     AirbyteProvisioner — Airbyte Cloud public API (https://api.airbyte.com/v1), bearer
                          AIRBYTE_API_KEY, workspace AIRBYTE_WORKSPACE_ID. One source per
                          connector, one connection per source, every tenant's rows land in the
                          warehouse schema t_<accountId> (hyphens → underscores).
     NoopProvisioner    — when either var is missing: every call is a no-op that reports
                          'error:sync_not_configured' so the ledger says "couldn't ask".

   Token handling: the OAuth tokens go into the Airbyte source configuration (Airbyte holds
   them encrypted on its side) and nowhere else — the request log records endpoint + names
   only. Handles (source/destination/connection ids — not secrets) persist on
   connectors.sync_ref so ensure* is idempotent.

   Verifiable here: request shaping (endpoints, bodies, schema naming, redaction). Only
   verifiable live: that the source definitions match the Airbyte connector versions of the
   day (field names are from the public connector specs as of 2026-09; check the Airbyte UI
   for the first real tenant), and whether Airbyte's Klaviyo source accepts an OAuth bearer
   token in `api_key` (its spec names a private key — see docs/CONNECTORS-FIRST-BOOT.md). */

import type { DbClient } from "@/lib/db/types";
import type { Platform } from "@/lib/runtime/types";
import type { FetchLike } from "./oauth";
import { getConnectorById, updateConnector, type ConnectorRow, type SyncResult } from "./store";
import type { AccessToken } from "./tokens";

export const AIRBYTE_API_BASE = "https://api.airbyte.com/v1";
const AIRBYTE_TIMEOUT_MS = 15_000;

export interface SyncStatus {
  state: "ok" | "empty" | "running" | "error";
  /** Ledger vocabulary, or null while running. */
  result: SyncResult | null;
  jobId?: string;
  at?: string;
}

export interface SyncProvisioner {
  readonly kind: "airbyte" | "noop";
  /** Airbyte source for this connector (created or reused). Returns the source id. */
  ensureSource(connector: ConnectorRow, token: AccessToken): Promise<string>;
  /** Warehouse destination for this tenant (created or reused). Returns the destination id. */
  ensureDestination(accountId: string): Promise<string>;
  /** Source → destination connection writing into t_<accountId>. Returns the connection id. */
  ensureConnection(connector: ConnectorRow, sourceId: string, destinationId: string): Promise<string>;
  triggerSync(connectionId: string): Promise<{ jobId: string }>;
  getStatus(connectionId: string): Promise<SyncStatus>;
}

/** Postgres-safe tenant schema: t_ + uuid with hyphens as underscores. */
export function tenantSchema(accountId: string): string {
  const cleaned = accountId.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `t_${cleaned}`;
}

// ---------- ledger ----------

/** Write the sync outcome with the provenance vocabulary. 'error:auth*' also flips the card to
    Reconnect, because "couldn't ask because the token is dead" needs the founder. */
export async function recordSyncResult(db: DbClient, connectorId: string, result: SyncResult, now: Date = new Date()): Promise<void> {
  const patch: Parameters<typeof updateConnector>[2] = { last_sync_at: now.toISOString(), last_sync_result: result };
  if (result.startsWith("error:auth")) patch.status = "needs_reconnect";
  await updateConnector(db, connectorId, patch);
}

// ---------- noop ----------

export class NoopProvisioner implements SyncProvisioner {
  readonly kind = "noop" as const;
  async ensureSource(): Promise<string> {
    return "noop";
  }
  async ensureDestination(): Promise<string> {
    return "noop";
  }
  async ensureConnection(): Promise<string> {
    return "noop";
  }
  async triggerSync(): Promise<{ jobId: string }> {
    return { jobId: "noop" };
  }
  async getStatus(): Promise<SyncStatus> {
    return { state: "error", result: "error:sync_not_configured" };
  }
}

// ---------- airbyte ----------

export interface AirbyteConfig {
  apiKey: string;
  workspaceId: string;
  /** Reuse a destination created in the Airbyte UI (recommended) … */
  destinationId?: string;
  /** … or create one per tenant from these warehouse credentials. */
  warehouse?: { host: string; port: number; database: string; username: string; password: string; sslMode?: string };
  /** Airbyte cron; default nightly 02:00 UTC. */
  cron?: string;
  /** First sync window start (YYYY-MM-DD). */
  startDate?: string;
  /** Needed by the google-ads source alongside the OAuth tokens. */
  googleAdsDeveloperToken?: string;
  /** App credentials the Google / Shopify sources need next to the user tokens. */
  clientCredentials?: Partial<Record<"google" | "shopify", { clientId: string; clientSecret: string }>>;
}

export function airbyteConfigFromEnv(env: Record<string, string | undefined> = process.env): AirbyteConfig | null {
  const apiKey = (env.AIRBYTE_API_KEY || "").trim();
  const workspaceId = (env.AIRBYTE_WORKSPACE_ID || "").trim();
  if (!apiKey || !workspaceId) return null;
  const host = (env.WAREHOUSE_PG_HOST || "").trim();
  const warehouse = host
    ? {
        host,
        port: Number.parseInt(env.WAREHOUSE_PG_PORT || "5432", 10),
        database: (env.WAREHOUSE_PG_DATABASE || "postgres").trim(),
        username: (env.WAREHOUSE_PG_USER || "").trim(),
        password: env.WAREHOUSE_PG_PASSWORD || "",
        sslMode: (env.WAREHOUSE_PG_SSL_MODE || "require").trim(),
      }
    : undefined;
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined;
  const shopify = env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET ? { clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET } : undefined;
  return {
    apiKey,
    workspaceId,
    destinationId: (env.AIRBYTE_DESTINATION_ID || "").trim() || undefined,
    warehouse,
    cron: (env.AIRBYTE_SYNC_CRON || "").trim() || undefined,
    startDate: (env.AIRBYTE_START_DATE || "").trim() || undefined,
    googleAdsDeveloperToken: (env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim() || undefined,
    clientCredentials: { google, shopify },
  };
}

export interface AirbyteDeps {
  db: DbClient;
  fetch: FetchLike;
  now: () => Date;
  /** Endpoint + names only; the provisioner never passes a configuration to it. */
  log?: (line: string) => void;
}

export class AirbyteApiError extends Error {
  constructor(readonly code: `http_${number}` | "timeout" | "network" | "malformed" | "not_configured") {
    super(`airbyte: ${code}`);
    this.name = "AirbyteApiError";
  }
}

/** Airbyte source definition per platform. `sourceType` names are the Airbyte Cloud API's. */
export function airbyteSourceConfiguration(platform: Platform, connector: ConnectorRow, token: AccessToken, cfg: AirbyteConfig): Record<string, unknown> {
  const startDate = cfg.startDate ?? defaultStartDate();
  switch (platform) {
    case "shopify": {
      const shop = (connector.external_ref || "").replace(/\.myshopify\.com$/, "");
      const app = cfg.clientCredentials?.shopify;
      return {
        sourceType: "shopify",
        shop,
        start_date: startDate,
        credentials: app ? { auth_method: "oauth2.0", client_id: app.clientId, client_secret: app.clientSecret, access_token: token.accessToken } : { auth_method: "api_password", api_password: token.accessToken },
      };
    }
    case "klaviyo":
      return { sourceType: "klaviyo", api_key: token.accessToken, start_date: `${startDate}T00:00:00Z` };
    case "meta_ads":
      return { sourceType: "facebook-marketing", account_ids: [(connector.external_ref || "").replace(/^act_/, "")], access_token: token.accessToken, start_date: `${startDate}T00:00:00Z`, include_deleted: false };
    case "ga4": {
      const app = cfg.clientCredentials?.google;
      return {
        sourceType: "google-analytics-data-api",
        property_ids: [connector.external_ref || ""],
        date_ranges_start_date: startDate,
        credentials: { auth_type: "Client", client_id: app?.clientId ?? "", client_secret: app?.clientSecret ?? "", refresh_token: token.refreshToken ?? "", access_token: token.accessToken },
      };
    }
    case "google_ads": {
      const app = cfg.clientCredentials?.google;
      return {
        sourceType: "google-ads",
        customer_id: (connector.external_ref || "").replace(/-/g, ""),
        start_date: startDate,
        credentials: { developer_token: cfg.googleAdsDeveloperToken ?? "", client_id: app?.clientId ?? "", client_secret: app?.clientSecret ?? "", refresh_token: token.refreshToken ?? "", access_token: token.accessToken },
      };
    }
    default:
      throw new AirbyteApiError("not_configured");
  }
}

function defaultStartDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export class AirbyteProvisioner implements SyncProvisioner {
  readonly kind = "airbyte" as const;
  constructor(
    private readonly cfg: AirbyteConfig,
    private readonly deps: AirbyteDeps,
  ) {}

  private async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const url = `${AIRBYTE_API_BASE}${path}`;
    this.deps.log?.(`airbyte ${method} ${path}`);
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        method,
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(AIRBYTE_TIMEOUT_MS),
      });
    } catch (e) {
      throw new AirbyteApiError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
    }
    if (!res.ok) throw new AirbyteApiError(`http_${res.status}`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new AirbyteApiError("malformed");
    }
  }

  private syncRef(connector: ConnectorRow): Record<string, unknown> {
    return connector.sync_ref && typeof connector.sync_ref === "object" ? connector.sync_ref : {};
  }

  private async remember(connector: ConnectorRow, patch: Record<string, unknown>) {
    const next = { ...this.syncRef(connector), ...patch };
    connector.sync_ref = next;
    await updateConnector(this.deps.db, connector.id, { sync_ref: next });
  }

  async ensureSource(connector: ConnectorRow, token: AccessToken): Promise<string> {
    const existing = this.syncRef(connector).sourceId;
    const configuration = airbyteSourceConfiguration(connector.platform as Platform, connector, token, this.cfg);
    const name = `unc-${connector.platform}-${connector.account_id}`;
    if (typeof existing === "string" && existing) {
      // Tokens rotate: keep the source's credentials current.
      await this.call("PATCH", `/sources/${existing}`, { name, configuration });
      return existing;
    }
    const created = await this.call<{ sourceId: string }>("POST", "/sources", { name, workspaceId: this.cfg.workspaceId, configuration });
    if (!created?.sourceId) throw new AirbyteApiError("malformed");
    await this.remember(connector, { sourceId: created.sourceId });
    return created.sourceId;
  }

  async ensureDestination(accountId: string): Promise<string> {
    if (this.cfg.destinationId) return this.cfg.destinationId;
    const w = this.cfg.warehouse;
    if (!w) throw new AirbyteApiError("not_configured");
    const name = `unc-warehouse-${accountId}`;
    const list = await this.call<{ data?: { destinationId: string; name: string }[] }>("GET", `/destinations?workspaceIds=${encodeURIComponent(this.cfg.workspaceId)}&limit=100`);
    const found = list.data?.find((d) => d.name === name);
    if (found) return found.destinationId;
    const created = await this.call<{ destinationId: string }>("POST", "/destinations", {
      name,
      workspaceId: this.cfg.workspaceId,
      configuration: { destinationType: "postgres", host: w.host, port: w.port, database: w.database, schema: tenantSchema(accountId), username: w.username, password: w.password, ssl_mode: { mode: w.sslMode ?? "require" } },
    });
    if (!created?.destinationId) throw new AirbyteApiError("malformed");
    return created.destinationId;
  }

  async ensureConnection(connector: ConnectorRow, sourceId: string, destinationId: string): Promise<string> {
    const existing = this.syncRef(connector).connectionId;
    if (typeof existing === "string" && existing) return existing;
    const created = await this.call<{ connectionId: string }>("POST", "/connections", {
      name: `unc-${connector.platform}-${connector.account_id}`,
      sourceId,
      destinationId,
      namespaceDefinition: "custom_format",
      namespaceFormat: tenantSchema(connector.account_id),
      prefix: `${connector.platform}_`,
      schedule: { scheduleType: "cron", cronExpression: this.cfg.cron ?? "0 0 2 * * ?" },
      nonBreakingSchemaUpdatesBehavior: "propagate_columns",
      status: "active",
    });
    if (!created?.connectionId) throw new AirbyteApiError("malformed");
    await this.remember(connector, { connectionId: created.connectionId, destinationId });
    return created.connectionId;
  }

  async triggerSync(connectionId: string): Promise<{ jobId: string }> {
    const job = await this.call<{ jobId: string | number }>("POST", "/jobs", { connectionId, jobType: "sync" });
    if (job?.jobId === undefined) throw new AirbyteApiError("malformed");
    return { jobId: String(job.jobId) };
  }

  async getStatus(connectionId: string): Promise<SyncStatus> {
    const res = await this.call<{ data?: { jobId: string | number; status: string; rowsSynced?: number; lastUpdatedAt?: string; startTime?: string }[] }>(
      "GET",
      `/jobs?connectionId=${encodeURIComponent(connectionId)}&jobType=sync&limit=1&orderBy=createdAt%7CDESC`,
    );
    const job = res.data?.[0];
    if (!job) return { state: "error", result: "error:no_sync_yet" };
    const at = job.lastUpdatedAt ?? job.startTime;
    const base = { jobId: String(job.jobId), ...(at ? { at } : {}) };
    switch (job.status) {
      case "succeeded":
        return job.rowsSynced === 0 ? { state: "empty", result: "empty", ...base } : { state: "ok", result: "ok", ...base };
      case "running":
      case "pending":
      case "incomplete":
        return { state: "running", result: null, ...base };
      case "cancelled":
        return { state: "error", result: "error:sync_cancelled", ...base };
      default:
        return { state: "error", result: `error:sync_${job.status || "failed"}`, ...base };
    }
  }
}

/** Airbyte when configured, otherwise the Noop. */
export function getProvisioner(deps: AirbyteDeps, env: Record<string, string | undefined> = process.env): SyncProvisioner {
  const cfg = airbyteConfigFromEnv(env);
  return cfg ? new AirbyteProvisioner(cfg, deps) : new NoopProvisioner();
}

/** End-to-end for one connector: source → destination → connection → first sync, ledgered. */
export async function provisionConnector(connectorId: string, token: AccessToken, provisioner: SyncProvisioner, deps: AirbyteDeps): Promise<{ connectionId: string; jobId: string } | null> {
  const connector = await getConnectorById(deps.db, connectorId);
  if (!connector) return null;
  try {
    const sourceId = await provisioner.ensureSource(connector, token);
    const destinationId = await provisioner.ensureDestination(connector.account_id);
    const connectionId = await provisioner.ensureConnection(connector, sourceId, destinationId);
    const { jobId } = await provisioner.triggerSync(connectionId);
    return { connectionId, jobId };
  } catch (e) {
    const code = e instanceof AirbyteApiError ? e.code : "provision";
    await recordSyncResult(deps.db, connectorId, `error:airbyte_${code}`, deps.now());
    return null;
  }
}
