import type { Membership } from "./accountState";

export const ACCOUNT_SELECTION_HEADER = "x-unc-account-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AccountSelection =
  | { ok: true; membership: Membership }
  | { ok: false; code: "account_selection_required" | "account_selection_invalid" | "account_access_denied" };

/** A requested ID is a selector, never a grant. Resolve it against freshly read
 * memberships for the verified caller. No cookie, global active account, role
 * promotion or fallback to another account after a stale/invalid selection. */
export function selectAccountMembership(memberships: readonly Membership[], requested?: unknown): AccountSelection {
  if (requested !== undefined && requested !== null) {
    if (typeof requested !== "string" || !UUID.test(requested)) return { ok: false, code: "account_selection_invalid" };
    const membership = memberships.find(m => m.accountId.toLowerCase() === requested.toLowerCase());
    return membership ? { ok: true, membership } : { ok: false, code: "account_access_denied" };
  }
  if (memberships.length === 1) return { ok: true, membership: memberships[0] };
  return { ok: false, code: memberships.length ? "account_selection_required" : "account_access_denied" };
}
