import { describe, expect, it } from "vitest";
import { connectorHasRealSync } from "../sync";

describe("connectorHasRealSync", () => {
  it("only ok and empty on a connected row count — never in-flight or error", () => {
    expect(connectorHasRealSync("connected", "ok")).toBe(true);
    expect(connectorHasRealSync("connected", "empty")).toBe(true);
    expect(connectorHasRealSync("connected", null)).toBe(false);
    expect(connectorHasRealSync("connected", undefined)).toBe(false);
    expect(connectorHasRealSync("connected", "error:first_read")).toBe(false);
    expect(connectorHasRealSync("connected", "error:no_reader")).toBe(false);
    expect(connectorHasRealSync("needs_reconnect", "ok")).toBe(false);
    expect(connectorHasRealSync("disconnected", null)).toBe(false);
    expect(connectorHasRealSync("connecting", null)).toBe(false);
  });
});
