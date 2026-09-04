/* The n8n bridge: signed POST, the three reply shapes, failures; the HMAC helpers both ways. */

import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { sign, verify } from "../../lib/artifacts/signing";
import type { ProduceNode, RunContext } from "../../lib/runtime/types";
import { buildN8nPayload, HttpN8nBridge, parseN8nReply } from "../providers/n8n";
import {
  collectWebhookResponse,
  MAX_N8N_RESPONSE_BYTES,
  pinnedNodeRequestOptions,
  type WebhookFetch,
} from "../providers/pinnedWebhookFetch";

const node: ProduceNode = { kind: "produce", id: "produce", skill: "D01-W01", maxItems: 3 };
const workflow = { id: "w1", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/webhook/founder", active: true };
function ctx(): RunContext {
  return { runId: "run-1", routineId: "D01-W01", version: 1, mode: "dry_run", startedAt: "2026-09-03T07:00:00.000Z", account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 }, caps: { currency: "NZD", perDay: 100, perMonth: 3000 }, triggeredBy: "schedule", vars: { website: "acme.test" }, inputs: { about_the_business: "physio" }, reads: { questions: { rows: [{ subject: "Refund?" }], metrics: { count: 1 }, fetchedAt: "x" } }, checks: {} };
}
const env = { N8N_SIGNING_SECRET: "s3cret" };
const NOW = new Date("2026-09-03T07:00:00.000Z");

function fetchStub(status: number, body?: unknown) {
  const calls: { url: string; init: RequestInit; pin: { address: string; family: 4 | 6 } | null }[] = [];
  const f: WebhookFetch = async (url, init, pin) => {
    calls.push({ url: String(url), init, pin });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

describe("signing", () => {
  it("signs and verifies; rejects a missing / stale / tampered signature or no secret", () => {
    const ts = String(NOW.getTime());
    const body = '{"runId":"run-1"}';
    const sig = sign("s3cret", body, ts);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verify("s3cret", body, ts, sig, { now: () => NOW })).toEqual({ ok: true });
    expect(verify("s3cret", body, ts, sig, { now: () => new Date(NOW.getTime() + 6 * 60_000) })).toEqual({ ok: false, reason: "stale" });
    expect(verify("s3cret", body + " ", ts, sig, { now: () => NOW })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify("other", body, ts, sig, { now: () => NOW })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify("s3cret", body, null, sig)).toEqual({ ok: false, reason: "missing" });
    expect(verify("", body, ts, sig)).toEqual({ ok: false, reason: "no_secret" });
  });
});

describe("HttpN8nBridge", () => {
  it("POSTs the signed payload and takes a synchronous artifact", async () => {
    const { f, calls } = fetchStub(200, { artifact: { kind: "post_set", title: "From n8n", body: "Made by the workflow with 9,999 words.", items: [{ title: "a", body: "b" }] } });
    const bridge = new HttpN8nBridge({ env, fetch: f, now: () => NOW });
    const out = await bridge.call(node, ctx(), workflow);
    expect(out).toMatchObject({ kind: "artifact", artifact: { title: "From n8n", kind: "post_set" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(workflow.webhookUrl);
    const headers = calls[0].init.headers as Record<string, string>;
    const body = String(calls[0].init.body);
    expect(headers["x-unc-timestamp"]).toBe(String(NOW.getTime()));
    expect(calls[0].init.redirect).toBe("manual");
    expect(verify("s3cret", body, headers["x-unc-timestamp"], headers["x-unc-signature"], { now: () => NOW })).toEqual({ ok: true });
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ accountId: "acct-1", runId: "run-1", routineId: "D01-W01", skill: "D01-W01", kind: "post_set", inputs: { about_the_business: "physio" }, callback: { path: "/api/routines/artifacts" } });
    expect(payload.reads.questions).toMatchObject({ count: 1, sample: [{ subject: "Refund?" }] });
    expect(buildN8nPayload(node, ctx()).vars).toEqual({ website: "acme.test" });
  });

  it("202 → accepted; { needs } → needs; a banned phrase in the artifact is rejected", async () => {
    expect(await new HttpN8nBridge({ env, fetch: fetchStub(202).f, now: () => NOW }).call(node, ctx(), workflow)).toEqual({ kind: "accepted" });
    expect(await new HttpN8nBridge({ env, fetch: fetchStub(200, { needs: [{ input: "brand_notes", why: "need them" }] }).f, now: () => NOW }).call(node, ctx(), workflow)).toEqual({ kind: "needs", needs: [{ input: "brand_notes", why: "need them" }] });
    await expect(new HttpN8nBridge({ env, fetch: fetchStub(200, { artifact: { kind: "post_set", title: "t", body: "This will 10x your business in a month, guaranteed by the workflow.", items: [{ title: "Test", body: "Test item" }] } }).f, now: () => NOW }).call(node, ctx(), workflow)).rejects.toThrow("banned phrases: 10x, guarantee");
    expect(() => parseN8nReply({}, "post_set")).toThrow("neither artifact nor needs");
  });

  it("refuses to call unsigned, fails on a bad status, resolves explicit node URLs and env keys", async () => {
    await expect(new HttpN8nBridge({ env: {}, fetch: fetchStub(200).f }).call(node, ctx(), workflow)).rejects.toThrow("N8N_SIGNING_SECRET is not set");
    await expect(new HttpN8nBridge({ env, fetch: fetchStub(200).f }).call(node, ctx(), null)).rejects.toThrow("no n8n webhook is registered");
    await expect(new HttpN8nBridge({ env, fetch: fetchStub(500).f }).call(node, ctx(), workflow)).rejects.toThrow("n8n webhook answered 500");
    const { f, calls } = fetchStub(202);
    await new HttpN8nBridge({ env: { ...env, MY_HOOK: "https://n8n.test/from-env" }, fetch: f }).call({ kind: "n8n", id: "n", webhookUrlEnv: "MY_HOOK" }, ctx(), null);
    expect(calls[0].url).toBe("https://n8n.test/from-env");
  });

  it("blocks local/private SSRF targets in production, validates DNS immediately before fetch, and never follows redirects", async () => {
    const prod = { ...env, NODE_ENV: "production" };
    const untouched = fetchStub(202);
    await expect(new HttpN8nBridge({ env: prod, fetch: untouched.f }).call(node, ctx(), { ...workflow, webhookUrl: "https://127.0.0.1/hook" })).rejects.toThrow(/public host/);
    expect(untouched.calls).toHaveLength(0);

    const privateDns = fetchStub(202);
    await expect(
      new HttpN8nBridge({ env: prod, fetch: privateDns.f, lookup: async () => [{ address: "10.0.0.8", family: 4 }] }).call(node, ctx(), { ...workflow, webhookUrl: "https://n8n.example/hook" }),
    ).rejects.toThrow(/private or non-routable/);
    expect(privateDns.calls).toHaveLength(0);

    const redirected = fetchStub(302);
    await expect(
      new HttpN8nBridge({ env: prod, fetch: redirected.f, lookup: async () => [{ address: "93.184.216.34", family: 4 }] }).call(node, ctx(), { ...workflow, webhookUrl: "https://n8n.example/hook" }),
    ).rejects.toThrow("redirect refused (302)");
    expect(redirected.calls).toHaveLength(1);
    expect(redirected.calls[0].init.redirect).toBe("manual");
    expect(redirected.calls[0].pin).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("carries the one validated DNS answer into the request instead of resolving the hostname again", async () => {
    const sent = fetchStub(202);
    let lookups = 0;
    await new HttpN8nBridge({
      env: { ...env, NODE_ENV: "production" },
      fetch: sent.f,
      lookup: async () => {
        lookups += 1;
        return lookups === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
      },
    }).call(node, ctx(), { ...workflow, webhookUrl: "https://n8n.example:8443/hook?source=unc" });

    expect(lookups).toBe(1);
    expect(sent.calls[0]).toMatchObject({
      url: "https://n8n.example:8443/hook?source=unc",
      pin: { address: "93.184.216.34", family: 4 },
    });
  });

  it("builds the production socket request with the pinned IP but the original HTTPS Host and SNI", () => {
    const signal = AbortSignal.timeout(1234);
    const options = pinnedNodeRequestOptions(
      new URL("https://n8n.example:8443/webhook/run?source=unc"),
      { address: "93.184.216.34", family: 4 },
      { method: "POST", headers: { "content-type": "application/json", "x-unc-signature": "sha256=x" }, body: "signed-body", signal },
    );

    expect(options).toMatchObject({
      protocol: "https:",
      hostname: "93.184.216.34",
      family: 4,
      port: "8443",
      path: "/webhook/run?source=unc",
      method: "POST",
      servername: "n8n.example",
      rejectUnauthorized: true,
      headers: { host: "n8n.example:8443", "content-type": "application/json", "x-unc-signature": "sha256=x" },
      signal,
    });
  });

  it("rejects a webhook response that exceeds the bounded worker memory allowance", async () => {
    const stream = new PassThrough();
    const response = stream as unknown as import("node:http").IncomingMessage;
    response.statusCode = 200;
    response.headers = {};
    const result = new Promise((resolve, reject) => collectWebhookResponse(response, resolve, reject));

    stream.end(Buffer.alloc(MAX_N8N_RESPONSE_BYTES + 1));

    await expect(result).rejects.toThrow(`exceeded ${MAX_N8N_RESPONSE_BYTES} bytes`);
  });
});
