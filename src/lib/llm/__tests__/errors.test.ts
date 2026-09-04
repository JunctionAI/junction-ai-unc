import { describe, expect, it } from "vitest";
import { sanitiseProviderError } from "../errors";

describe("provider error sanitising", () => {
  it.each([
    ["Bearer eyJhbGciOiJIUzI1NiIsInRlc3Qi", "Bearer"],
    ["request failed for sk-ant-abcdef123456", "sk-ant-abcdef123456"],
    ["Incorrect API key provided: sk-abcdef123456", "sk-abcdef123456"],
    ["https://api.test/x?api_key=supersecret123&v=1", "supersecret123"],
    ["access_token = ya29.longtokenvalue", "ya29.longtokenvalue"],
  ])("removes %s", (message, secret) => {
    const safe = sanitiseProviderError(message);
    expect(safe).not.toContain(secret);
    expect(safe).toContain("[redacted]");
    expect(safe).not.toMatch(/\d+\[redacted\]/);
  });
});
