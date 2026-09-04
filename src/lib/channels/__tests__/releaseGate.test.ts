import { describe, expect, it, vi } from "vitest";
import { availability, buildAdapters } from "../adapters";
import { receiveSlack, receiveTelegram, receiveTwilio, receiveWhatsApp, receiveWhatsAppVerify } from "../webhooks";
import { receiveTnz } from "../tnzReceiver";

describe("messaging release gate", () => {
  const env = { UNC_MESSAGING_ENABLED: "false", TELEGRAM_BOT_TOKEN: "fixture", TELEGRAM_WEBHOOK_SECRET: "fixture", TELEGRAM_BOT_USERNAME: "UncBot" };
  const deps = { env, now: () => new Date(), appUrl: "https://unc.test" };
  it("removes all outbound adapters even when credentials exist", () => {
    const fetch = vi.fn();
    expect(buildAdapters({ env, fetch })).toEqual({});
    expect(availability(env)).toHaveLength(6);
    expect(availability(env).every(c => !c.configured && c.setupNote?.includes("disabled"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects ingress without acknowledging or processing a message", () => {
    const results = [
      receiveTelegram(deps, { secretToken: "fixture", rawBody: "{}" }),
      receiveWhatsApp(deps, { signature: null, rawBody: "{}" }),
      receiveWhatsAppVerify(deps, new URLSearchParams()),
      receiveSlack(deps, { signature: null, timestamp: null, contentType: null, rawBody: "{}" }),
      receiveTwilio(deps, { signature: null, rawBody: "" }),
    ];
    for (const result of results) expect(result).toEqual({ status: 503, body: { error: "messaging_disabled" }, events: [] });
  });
  it("does not enqueue or wake the TNZ worker", async () => {
    const save = vi.fn(), wake = vi.fn();
    const result = await receiveTnz(new Request("https://unc.test", { method: "POST", body: "{}" }), { env, now: new Date(), save, wake });
    expect(result.status).toBe(503);
    expect(save).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
});
