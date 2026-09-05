"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createAccountFetch, accountPagePath } from "@/lib/db/accountRequest";
import type { AccountChoice } from "@/lib/db/accountChoices";

const fallback = { accountId: null as string | null, choices: [] as AccountChoice[], request: createAccountFetch(null) };
const AccountScope = createContext(fallback);

export function AccountScopeProvider({ accountId, choices, children }: { accountId: string | null; choices: AccountChoice[]; children: ReactNode }) {
  const value = useMemo(() => ({ accountId, choices, request: createAccountFetch(accountId) }), [accountId, choices]);
  return <AccountScope.Provider value={value}>{children}</AccountScope.Provider>;
}

export const useAccountRequest = () => useContext(AccountScope).request;
export const useSelectedAccount = () => useContext(AccountScope).accountId;

/** Native navigation deliberately remounts the entire client tree. No shared
 * active-client cookie, optimistic role change or old-client component state. */
export function AccountSwitcher() {
  const { accountId, choices } = useContext(AccountScope);
  if (choices.length < 2) return null;
  return <label style={{ display: "grid", gap: 5, fontSize: 12, margin: "12px 0" }}>Client
    <select aria-label="Switch client" value={accountId ?? ""} onChange={event => {
      if (choices.some(choice => choice.accountId === event.target.value)) window.location.assign(accountPagePath(event.target.value));
    }} style={{ maxWidth: "100%", padding: 8, borderRadius: 8, color: "var(--ink)", background: "white" }}>
      {!accountId && <option value="" disabled>Choose a client</option>}
      {choices.map(choice => <option key={choice.accountId} value={choice.accountId}>{choice.name} · {choice.role === "member" ? "Read only" : "Owner"}</option>)}
    </select>
  </label>;
}
