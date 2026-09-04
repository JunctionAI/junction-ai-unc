import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinnedNodeRequestOptions } from "../../http/pinnedRequest";
import { collectPinnedPageResponse, type PinnedPageFetch, type PinnedPageResponse } from "../pinnedPageFetch";
import { safeFetchPage, type HostLookup } from "../scan";

describe("business scanner DNS pinning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs exactly one lookup per redirect hop and hands that exact address to the transport", async () => {
    const lookup = vi.fn<HostLookup>(async (hostname) => {
      if (hostname === "brand.example") return [{ address: "13.238.1.10", family: 4 }];
      if (hostname === "www.brand.example") return [{ address: "13.238.1.11", family: 4 }];
      throw new Error(`unexpected hostname ${hostname}`);
    });
    const calls: { url: string; address: string; maxBytes: number }[] = [];
    const request: PinnedPageFetch = async (url, pin, init) => {
      calls.push({ url: url.toString(), address: pin.address, maxBytes: init.maxBytes });
      return url.hostname === "brand.example"
        ? { status: 302, headers: new Headers({ location: "https://www.brand.example/about" }), body: "" }
        : { status: 200, headers: new Headers({ "content-type": "text/html; charset=utf-8" }), body: "<h1>Brand</h1>" };
    };

    await expect(safeFetchPage("https://brand.example/", { lookup, request })).resolves.toEqual({
      url: "https://www.brand.example/about",
      html: "<h1>Brand</h1>",
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls).toEqual([
      ["brand.example", { all: true }],
      ["www.brand.example", { all: true }],
    ]);
    expect(calls).toEqual([
      { url: "https://brand.example/", address: "13.238.1.10", maxBytes: 60_000 },
      { url: "https://www.brand.example/about", address: "13.238.1.11", maxBytes: 60_000 },
    ]);
  });

  it("retains at most the configured response bytes and closes the stream at the bound", async () => {
    const stream = new EventEmitter() as IncomingMessage;
    Object.assign(stream, {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      destroy: vi.fn(),
    });
    const result = new Promise<PinnedPageResponse>((resolve, reject) => collectPinnedPageResponse(stream, 5, resolve, reject));
    stream.emit("data", Buffer.from("abcdefghij"));
    await expect(result).resolves.toMatchObject({ status: 200, body: "abcde" });
    expect(stream.destroy).toHaveBeenCalledOnce();
  });

  it("uses the validated IP for HTTPS while retaining the original hostname for TLS SNI", () => {
    const options = pinnedNodeRequestOptions(
      new URL("https://brand.example:8443/about?from=scan"),
      { address: "13.238.1.10", family: 4 },
      { method: "GET", headers: { Accept: "text/html" } },
    );
    expect(options).toMatchObject({
      protocol: "https:",
      hostname: "13.238.1.10",
      family: 4,
      port: "8443",
      path: "/about?from=scan",
      servername: "brand.example",
      rejectUnauthorized: true,
      headers: { accept: "text/html", host: "brand.example:8443" },
    });
  });
});
