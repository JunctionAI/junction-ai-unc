import type { Env } from "./types";
import { z } from "zod";

const pilotSchema = z.object({
  accountId: z.uuid(), contextGeneration: z.number().int().nonnegative(), userId: z.uuid(),
  scopeId: z.string().regex(/^T[A-Z0-9]+$/), conversationId: z.string().regex(/^[CG][A-Z0-9]+$/),
  externalId: z.string().regex(/^[UW][A-Z0-9]+$/), expiresAt: z.string().datetime(),
}).strict();

/** Optional additional restriction, never an alternative to the global kill switch. */
export function messagingPilot(env: Env, now = Date.now()) {
  try {
    const p = pilotSchema.parse(JSON.parse(env.UNC_MESSAGING_PILOT_SCOPE ?? "null"));
    return Date.parse(p.expiresAt) > now ? p : null;
  } catch { return null; }
}

export function messagingOriginAllowed(env: Env, origin: {
  channel?: unknown; scopeId?: unknown; conversationId?: unknown; externalId?: unknown; threadId?: unknown;
}, now = Date.now()): boolean {
  if (messagingDisabled(env)) return false;
  if (env.UNC_MESSAGING_PILOT_SCOPE === undefined) return true;
  const p = messagingPilot(env, now);
  return !!p && origin.channel === "slack" && origin.scopeId === p.scopeId
    && origin.conversationId === p.conversationId && origin.externalId === p.externalId
    && typeof origin.threadId === "string" && /^\d{10}\.\d{6}$/.test(origin.threadId);
}

export function messagingBindingAllowed(env: Env, binding: {
  accountId?: unknown; contextGeneration?: unknown; userId?: unknown;
}, now = Date.now()): boolean {
  if (messagingDisabled(env)) return false;
  if (env.UNC_MESSAGING_PILOT_SCOPE === undefined) return true;
  const p = messagingPilot(env, now);
  return !!p && binding.accountId === p.accountId && binding.contextGeneration === p.contextGeneration && binding.userId === p.userId;
}

/** Server-side release switch. Does not affect authenticated in-app chat or login emails. */
export const messagingDisabled = (env: Env): boolean => env.NODE_ENV === "production"
  ? env.UNC_MESSAGING_ENABLED !== "true" : env.UNC_MESSAGING_ENABLED === "false";
export const MESSAGING_DISABLED_NOTE = "External messaging is disabled for this release. Use in-app chat.";
