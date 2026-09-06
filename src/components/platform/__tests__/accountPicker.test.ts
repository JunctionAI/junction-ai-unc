import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ choices: [] as { accountId: string; name: string; role: "owner" | "member" }[], error: null as string | null, billing: vi.fn() }));
vi.mock("@/lib/db/accountChoices", () => ({ accountChoicesForRequest: async () => ({ choices: f.choices, error: f.error }) }));
vi.mock("@/lib/billing/server", () => ({ getBillingForRequest: f.billing, pricingForRequest: async () => ({}) }));
vi.mock("../Platform", () => ({ default: () => createElement("div", null, "Selected client application") }));
import AppPage from "@/app/app/page";
import { AccountScopeProvider, AccountSwitcher } from "../AccountScope";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(() => { f.choices = [{ accountId: A, name: "Client A", role: "owner" }, { accountId: B, name: "Client B", role: "member" }]; f.error = null; f.billing.mockReset().mockResolvedValue({ configured: true, entitlement: { state: "active" } }); });
const page = async (account?: string | string[]) => renderToStaticMarkup(await AppPage({ searchParams: Promise.resolve({ account }) }));
describe("client choice before hydration or billing", () => {
  it("asks for a choice before loading any client application or subscription", async () => {
    const html = await page();
    expect(html).toContain("Choose your client workspace");
    expect(html).toContain(`/app?account=${A}`); expect(html).toContain(`/app?account=${B}`);
    expect(html).toContain("Read-only member");
    expect(html).not.toContain("Selected client application");
    expect(f.billing).not.toHaveBeenCalled();
  });
  it("resolves billing for the same explicitly selected client before rendering the application", async () => {
    expect(await page(B)).toContain("Selected client application");
    expect(f.billing).toHaveBeenCalledExactlyOnceWith(B);
  });
  it.each(["not-an-id", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", [A, B]])("refuses unavailable or duplicated selection %s", async account => {
    expect(await page(account)).toContain("That client selection is unavailable");
    expect(f.billing).not.toHaveBeenCalled();
  });
  it("keeps single-client compatibility and stops if client access cannot be read", async () => {
    f.choices = [f.choices[0]];
    expect(await page()).toContain("Selected client application");
    expect(f.billing).toHaveBeenCalledWith(A);
    f.billing.mockClear(); f.error = "Access unavailable"; f.choices = [];
    expect(await page(A)).toContain("Access unavailable");
    expect(f.billing).not.toHaveBeenCalled();
  });
  it("renders an accessible client switcher with the actual selected member account", () => {
    // eslint-disable-next-line react/no-children-prop -- createElement's required children prop is not inferred from its third argument here.
    const html = renderToStaticMarkup(createElement(AccountScopeProvider, { accountId: B, choices: f.choices, children: createElement(AccountSwitcher) }));
    expect(html).toContain('aria-label="Switch client"');
    expect(html).toContain(`value="${B}" selected=""`);
    expect(html).toContain("Read only");
  });
});
