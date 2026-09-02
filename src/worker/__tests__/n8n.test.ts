/* The n8n bridge: signed POST, the three reply shapes, failures; the HMAC helpers both ways. */

import { describe, expect, it } from "vitest";
import { sign, verify } from "../../lib/artifacts/signing";
import type { ProduceNode, RunContext } from "../../lib/runtime/types";
import { buildN8nPayload, HttpN8nBridge, parseN8nReply } from "../providers/n8n";

const node: ProduceNode = { kind: "produce", id: "produce", skill: "D01-W01", maxItems: 3 };
const workflow = { id: "w1", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/webhook/founder", active: true };
function ctx(): RunContext {
  return { runId: "run-1", routineId: "D01-W01", version: 1, mode: "dry_run", startedAt: "2026-09-03T07:00:00.000Z", account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 }, caps: { currency: "NZD", perDay: 100, perMonth: 3000 }, triggeredBy: "schedule", vars: { website: "acme.test" }, inputs: { about_the_business: "physio" }, reads: { questions: { rows: [{ subject: "Refund?" }], metrics: { count: 1 }, fetchedAt: "x" } }, checks: {} };
}
const env = { N8N_SIGNING_SECRET: "s3cret" };
const NOW = new Date("2026-09-03T07:00:00.000Z");

function fetchStub(status: number, body?: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
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
    expect(verify("s3cret", body, headers["x-unc-timestamp"], headers["x-unc-signature"], { now: () => NOW })).toEqual({ ok: true });
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ accountId: "acct-1", runId: "run-1", routineId: "D01-W01", skill: "D01-W01", kind: "post_set", inputs: { about_the_business: "physio" }, callback: { path: "/api/routines/artifacts" } });
    expect(payload.reads.questions).toMatchObject({ count: 1, sample: [{ subject: "Refund?" }] });
    expect(buildN8nPayload(node, ctx()).vars).toEqual({ website: "acme.test" });
  });

  it("202 → accepted; { needs } → needs; a banned phrase in the artifact is rejected", async () => {
    expect(await new HttpN8nBridge({ env, fetch: fetchStub(202).f, now: () => NOW }).call(node, ctx(), workflow)).toEqual({ kind: "accepted" });
    expect(await new HttpN8nBridge({ env, fetch: fetchStub(200, { needs: [{ input: "brand_notes", why: "need them" }] }).f, now: () => NOW }).call(node, ctx(), workflow)).toEqual({ kind: "needs", needs: [{ input: "brand_notes", why: "need them" }] });
    await expect(new HttpN8nBridge({ env, fetch: fetchStub(200, { artifact: { kind: "generic", title: "t", body: "This will 10x your business in a month, guaranteed by the workflow." } }).f, now: () => NOW }).call(node, ctx(), workflow)).rejects.toThrow("banned phrases: 10x, guarantee");
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
});
