import { ACCOUNT_SELECTION_HEADER } from "./accountSelection";

export type AccountFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Captures a page's client, not a mutable cookie or global selection. Only our
 * relative API paths are accepted, so client context cannot leak to a provider. */
export function createAccountFetch(accountId: string | null, fetcher?: typeof fetch): AccountFetch {
  return async (path, init) => {
    if (!path.startsWith("/api/") || path.includes("\\") || new URL(path, "https://unc.invalid").pathname.startsWith("/api/") === false)
      throw new Error("Account requests must use a local API path.");
    const headers = new Headers(init?.headers);
    const supplied = headers.get(ACCOUNT_SELECTION_HEADER);
    if (accountId && supplied && supplied.toLowerCase() !== accountId.toLowerCase()) throw new Error("Client selection changed. Reload before continuing.");
    if (accountId) headers.set(ACCOUNT_SELECTION_HEADER, accountId);
    return (fetcher ?? fetch)(path, { ...init, credentials: "same-origin", redirect: "error", headers });
  };
}

export function accountPagePath(accountId: string): string {
  return `/app?account=${encodeURIComponent(accountId)}`;
}
