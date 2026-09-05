/* Connect with a token — the owner path (POST /api/connectors/<platform>/manual).

   Gates, in order: platform known + has a token path → secret store → accounts DB → session
   → membership → OWNER role → well-formed body. Then ONE cheap read against the platform
   (manualValidate.ts) proves the key; only a key that answered is sealed. The row flips to
   `connected` with its external_ref, a receipt says what happened, and deps.onConnected fires
   so the first certified read ("Reading your last 90 days") starts at once (firstRead.ts).

   Nothing here logs, returns or receipts a token value. */

import { insertSystemReceipt } from "@/lib/db/receipts";
import { seal } from "./crypto";
import type { HandlerDeps } from "./handlers";
import { hasTokenPath, MANUAL_FORMS, type ManualPlatform } from "./manualFields";
import { ManualValidationError, validateManualToken, type ManualInput } from "./manualValidate";
import { connectorEntry } from "./registry";
import { accountForUser, getConnector, memberRole, putSecret, upsertConnector } from "./store";

export type ManualResult =
  | { status: 200; body: { ok: true; platform: string; externalRef: string | null; label: string; reading: boolean } }
  | { status: 400 | 401 | 403 | 404 | 503; body: { error: string; code?: string } };

const err = (status: 400 | 401 | 403 | 404 | 503, error: string, code?: string): ManualResult => ({ status, body: code ? { error, code } : { error } });

const MAX_TOKEN = 4096;

/** Body → ManualInput, or a one-line reason. Field names are the form's (manualFields.ts). */
export function parseManualBody(platform: ManualPlatform, body: unknown): ManualInput | { error: string } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const extra = b.extra && typeof b.extra === "object" ? (b.extra as Record<string, unknown>) : {};
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!token) return { error: "paste the key first" };
  if (token.length > MAX_TOKEN) return { error: "that doesn't look like a key (too long)" };
  const externalRef = typeof b.external_ref === "string" ? b.external_ref.trim() : undefined;
  const shop = typeof extra.shop === "string" ? extra.shop.trim() : typeof b.shop === "string" ? b.shop.trim() : undefined;
  const expiresAt = typeof extra.expires_at === "string" ? extra.expires_at.trim() : undefined;
  for (const f of MANUAL_FORMS[platform].fields) {
    if (f.key === "shop" && !shop) return { error: "the store domain is needed" };
    if (f.key === "external_ref" && !externalRef) return { error: `${f.label.toLowerCase()} is needed` };
  }
  return { token, externalRef, shop, expiresAt };
}

export async function handleManualConnect(deps: HandlerDeps, platform: string, body: unknown): Promise<ManualResult> {
  const entry = connectorEntry(platform);
  if (!entry) return err(404, "unknown platform");
  if (!hasTokenPath(entry.id)) return err(404, "no token path for this platform yet");
  const p: ManualPlatform = entry.id;
  if (!deps.config.keyring) return err(503, "the secret store isn't configured (CONNECTOR_SECRET_KEY) — nothing can be stored", "secret_store_not_configured");
  if (!deps.config.dbConfigured || !deps.db) return err(503, "account storage isn't configured", "accounts_not_configured");
  if (!deps.userId) return err(401, "sign in first");
  const db = deps.db;
  const accountId = await accountForUser(db, deps.userId, deps.requestedAccountId);
  if (!accountId) return err(403, "no account for this user");
  const role = await memberRole(db, deps.userId, accountId);
  if (role !== "owner") return err(403, "only the account owner can paste a key", "owner_only");

  const parsed = parseManualBody(p, body);
  if ("error" in parsed) return err(400, parsed.error);

  let validation;
  try {
    validation = await validateManualToken(p, parsed, { fetch: deps.fetch, env: deps.config.env, now: deps.now });
  } catch (e) {
    if (e instanceof ManualValidationError) {
      deps.log?.(`connectors.manual platform=${p} account=${accountId} result=${e.code}`);
      return err(400, `${entry.name} said: ${e.detail}`, e.code);
    }
    deps.log?.(`connectors.manual platform=${p} account=${accountId} result=unexpected`);
    return err(400, `${entry.name} couldn't be reached just now — nothing was stored`);
  }

  const now = deps.now();
  const previous = await getConnector(db, accountId, p);
  const connectorId = await upsertConnector(db, accountId, p, { status: "connected", external_ref: validation.externalRef, last_sync_at: null, last_sync_result: null });
  await putSecret(db, connectorId, seal(JSON.stringify(validation.bundle), deps.config.keyring, connectorId), now.toISOString());
  await insertSystemReceipt(db, {
    accountId,
    kind: "notification",
    platform: p,
    description: `${entry.name} connected with a key you pasted — ${validation.label}. I tested it with one read before keeping it; the key is sealed in the secret store. Reading your last 90 days now.`,
    payload: { connector_id: connectorId, platform: p, external_ref: validation.externalRef, source: "manual", previous_status: previous?.status ?? null },
    now: now.toISOString(),
  });
  deps.log?.(`connectors.manual platform=${p} account=${accountId} result=connected`);

  let reading = false;
  if (deps.onConnected) {
    try {
      deps.onConnected({ accountId, platform: p, connectorId });
      reading = true;
    } catch {
      /* the connection stands; the nightly snapshot will read it */
    }
  }
  return { status: 200, body: { ok: true, platform: p, externalRef: validation.externalRef, label: validation.label, reading } };
}
