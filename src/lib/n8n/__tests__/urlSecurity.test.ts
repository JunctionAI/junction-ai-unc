import { describe, expect, it } from "vitest";
import { checkWebhookTarget, checkWebhookUrl, isPrivateWebhookAddress } from "../urlSecurity";

const PROD = { NODE_ENV: "production" };

describe("n8n webhook SSRF boundary", () => {
  it("rejects loopback, private, link-local, metadata and internal host targets in production", () => {
    for (const url of [
      "https://localhost/hook",
      "https://foo.localhost/hook",
      "https://n8n.internal/hook",
      "https://n8n.local/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
    ]) expect(checkWebhookUrl(url, PROD, 2000)).toMatchObject({ ok: false });
  });

  it("ignores private-dev flags in production and permits local n8n only in test or opted-in development", () => {
    expect(checkWebhookUrl("http://localhost:5678/hook", { NODE_ENV: "production", N8N_ALLOW_HTTP: "1", N8N_ALLOW_PRIVATE_DEV: "1" }, 2000).ok).toBe(false);
    expect(checkWebhookUrl("http://localhost:5678/hook", { NODE_ENV: "development", N8N_ALLOW_HTTP: "1", N8N_ALLOW_PRIVATE_DEV: "1" }, 2000).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:5678/hook", { NODE_ENV: "development", N8N_ALLOW_HTTP: "1" }, 2000).ok).toBe(false);
    expect(checkWebhookUrl("http://localhost:5678/hook", { NODE_ENV: "test" }, 2000).ok).toBe(true);
  });

  it("rejects a public hostname when any current DNS answer is private", async () => {
    const mixed = await checkWebhookTarget("https://n8n.example/hook", PROD, {
      maxLength: 2000,
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.10", family: 4 },
      ],
    });
    expect(mixed).toMatchObject({ ok: false, reason: expect.stringContaining("private") });
    expect(await checkWebhookTarget("https://n8n.example/hook", PROD, { maxLength: 2000, lookup: async () => [{ address: "93.184.216.34", family: 4 }] })).toMatchObject({
      ok: true,
      pin: { address: "93.184.216.34", family: 4 },
    });
  });

  it("pins public IP literals without another DNS lookup", async () => {
    let lookups = 0;
    const checked = await checkWebhookTarget("https://93.184.216.34/hook", PROD, {
      maxLength: 2000,
      lookup: async () => {
        lookups += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    expect(checked).toMatchObject({ ok: true, pin: { address: "93.184.216.34", family: 4 } });
    expect(lookups).toBe(0);
  });

  it("classifies IPv4, IPv6 and mapped loopback/private addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPrivateWebhookAddress(address)).toBe(true);
    }
    expect(isPrivateWebhookAddress("93.184.216.34")).toBe(false);
    expect(isPrivateWebhookAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});
