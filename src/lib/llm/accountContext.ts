/* SERVER ONLY (imports next/headers through ../db/server).

   requireModelAccountContext(): the spend boundary for browser-triggered model calls.
   A configured deployment requires the signed-in account owner and returns its service-role
   DB so usage is tenant-attributed and checked against the durable account budget. A production
   deployment is not allowed to expose paid model calls without account storage. Local/test
   demo mode (no Supabase) can still exercise the deterministic/model fallback path. */

import { isDbConfigured } from "../db/client";
import { requireAccountOwnerSession } from "../db/session";
import type { DbClient } from "../db/types";
import { accountContextGeneration, contextMemoryDb, contextRequestMatches, CONTEXT_CHANGED_MESSAGE } from "../db/contextGeneration";

export interface ModelAccountContext {
  accountId: string;
  userId?: string;
  contextGeneration?: number;
  db: DbClient;
}

const unavailable = () => Response.json({ error: "account storage is required for model access" }, { status: 503 });

export async function requireModelAccountContext(req?: Request): Promise<ModelAccountContext | Response | null> {
  if (!isDbConfigured()) return process.env.NODE_ENV === "production" ? unavailable() : null;
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const requestedAccount = req?.headers.get("x-unc-account-id");
  if (requestedAccount && requestedAccount !== session.accountId)
    return Response.json({ error: CONTEXT_CHANGED_MESSAGE, code: "context_changed" }, { status: 409 });
  try {
    const contextGeneration = await accountContextGeneration(session.service, session.accountId);
    if (req && !contextRequestMatches(req, contextGeneration)) return Response.json({ error: CONTEXT_CHANGED_MESSAGE, code: "context_changed" }, { status: 409 });
    return { accountId: session.accountId, userId: session.userId, contextGeneration, db: contextMemoryDb(session.service, session.accountId, contextGeneration) };
  } catch { return unavailable(); }
}
