import { describe, expect, it, vi } from "vitest";
import { createAccountFetch, accountPagePath } from "../accountRequest";
import { accountNavigationRequest, ACCOUNT_SELECTION_HEADER } from "../accountSelection";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("page-captured client requests", () => {
  it("keeps concurrent pages and retries bound, preserving payloads and context headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const a = createAccountFetch(A, fetcher), b = createAccountFetch(B, fetcher);
    const init = { method: "POST", headers: { "content-type": "application/json", "x-unc-context-generation": "7" }, body: '{"requestId":"retry-me"}' };
    await Promise.all([a("/api/routines/request", init), b("/api/routines/request", init)]);
    await a("/api/routines/request", init);
    expect(fetcher.mock.calls.map(c => new Headers(c[1]?.headers).get(ACCOUNT_SELECTION_HEADER))).toEqual([A, B, A]);
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({ body: init.body, credentials: "same-origin", redirect: "error" });
      expect(new Headers(call[1]?.headers).get("x-unc-context-generation")).toBe("7");
    }
    expect(init.headers).not.toHaveProperty(ACCOUNT_SELECTION_HEADER);
  });
  it.each(["https://evil.test/api/read", "//evil.test/api/read", "/login", "/api/../auth", "/api/%2e%2e/auth", "/api/\\evil"])("refuses non-local API destination %s before any fetch", async path => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createAccountFetch(A, fetcher)(path)).rejects.toThrow("local API");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses an old component's conflicting client rather than relabeling its payload", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createAccountFetch(B, fetcher)("/api/account/state", { headers: { [ACCOUNT_SELECTION_HEADER]: A } })).rejects.toThrow("Client selection changed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("encodes a client link and handles duplicate/conflicting navigation selections fail-closed", () => {
    expect(accountPagePath(A)).toBe(`/app?account=${A}`);
    const req = (query: string, header?: string) => new Request(`https://unc.test/api/channels/slack/start?${query}`, { headers: header ? { [ACCOUNT_SELECTION_HEADER]: header } : {} });
    expect(accountNavigationRequest(req(`account=${B}`)).headers.get(ACCOUNT_SELECTION_HEADER)).toBe(B);
    expect(accountNavigationRequest(req(`account=${B}&account=${A}`)).headers.get(ACCOUNT_SELECTION_HEADER)).toBe("");
    expect(accountNavigationRequest(req(`account=${B}`, A)).headers.get(ACCOUNT_SELECTION_HEADER)).toBe("");
  });
});
