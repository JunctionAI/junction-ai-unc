import { describe, expect, it } from "vitest";
import { messagingOriginAllowed, messagingBindingAllowed } from "../releaseGate";

const now = Date.parse("2026-09-06T03:00:00.000Z");
const scope = { accountId: "aa5cfc84-2569-4c99-9b40-67003ae55eda", contextGeneration: 1,
  userId: "74802c60-149a-4405-b719-dc058d174072", scopeId: "T0BMD3LMWUQ",
  conversationId: "C0BR8UNSR26", externalId: "U123ABC", expiresAt: "2026-09-06T04:00:00.000Z" };
const env = { NODE_ENV: "production", UNC_MESSAGING_ENABLED: "true", UNC_MESSAGING_PILOT_SCOPE: JSON.stringify(scope) };
const origin = { ...scope, channel: "slack", threadId: "1788663600.123456" };
describe("bounded Slack messaging pilot", () => {
  it("allows only the exact unexpired origin and account binding", () => {
    expect(messagingOriginAllowed(env, origin, now)).toBe(true);
    expect(messagingBindingAllowed(env, scope, now)).toBe(true);
  });
  it.each(["channel", "scopeId", "conversationId", "externalId", "threadId"])("rejects wrong %s", key => {
    expect(messagingOriginAllowed(env, { ...origin, [key]: "wrong" }, now)).toBe(false);
  });
  it.each(["accountId", "contextGeneration", "userId"])("rejects wrong %s", key => {
    expect(messagingBindingAllowed(env, { ...scope, [key]: "wrong" }, now)).toBe(false);
  });
  it.each(["", "{", "null", "{}", JSON.stringify({ ...scope, extra: true })])("malformed scope fails closed: %s", raw => {
    const config = { ...env, UNC_MESSAGING_PILOT_SCOPE: raw };
    expect(messagingOriginAllowed(config, origin, now)).toBe(false);
    expect(messagingBindingAllowed(config, scope, now)).toBe(false);
  });
  it("rechecks expiry and preserves the global kill switch", () => {
    expect(messagingOriginAllowed(env, origin, Date.parse(scope.expiresAt))).toBe(false);
    expect(messagingBindingAllowed(env, scope, Date.parse(scope.expiresAt))).toBe(false);
    expect(messagingOriginAllowed({ ...env, UNC_MESSAGING_ENABLED: "false" }, origin, now)).toBe(false);
    expect(messagingBindingAllowed({ ...env, UNC_MESSAGING_ENABLED: "false" }, scope, now)).toBe(false);
  });
});
