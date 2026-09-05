import { unwrap, type DbClient } from "../db/types";
import { RuntimeContextError, runtimeGeneration, type RuntimeContextIdentity } from "../runtime/contextFence";
import type { SealedSecret } from "./crypto";
import type { ConnectorRow, NativeOauthBinding } from "./store";

export interface TokenContext { accountId: string; contextGeneration: number; binding: NativeOauthBinding; enforcePause: boolean; actor: string | null }
export interface TokenCapture { context: TokenContext; row: ConnectorRow; sealed: SealedSecret | null }

export async function captureToken(db: DbClient, row: ConnectorRow, expected?: RuntimeContextIdentity, actor?: string): Promise<TokenCapture | null> {
  if (expected && expected.accountId !== row.account_id) throw new RuntimeContextError("context_changed", "The credential does not belong to this run.");
  const result = await unwrap<TokenCapture | null>("connector.token.capture", db.rpc("capture_connector_token", {
    p_connector: row.id, p_account: row.account_id, p_platform: row.platform,
    p_generation: expected ? runtimeGeneration(expected.contextGeneration) : null,
    p_actor: actor ?? null,
  }));
  if (!result && expected) throw new RuntimeContextError("context_changed", "The original credential context is no longer available.");
  return result;
}

export async function assertTokenContext(db: DbClient, context: TokenContext): Promise<void> {
  const current = await unwrap<boolean>("connector.token.check", db.rpc("check_connector_token_context", { captured: context }));
  if (current !== true) throw new RuntimeContextError("context_changed", "The connection changed while this request was in flight.");
}

export async function settleToken(db: DbClient, context: TokenContext, outcome: {
  kind: "success" | "reconnect" | "temporary" | "configuration"; code?: string; sealed?: SealedSecret; holder?: string;
  refreshAttempt?: boolean; retryable?: boolean;
}): Promise<TokenContext> {
  const updated = await unwrap<TokenContext | null>("connector.token.settle", db.rpc("settle_connector_token", { input: { context, ...outcome } }));
  if (!updated) throw new RuntimeContextError("context_changed", "The token result was not accepted for its original connection.");
  return updated;
}
