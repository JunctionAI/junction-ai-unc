/* The artifacts API + resume-input + the n8n callback, in demo mode (MemoryStore, unbound). */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listGet } from "../../../app/api/artifacts/route";
import { GET as oneGet, POST as onePost } from "../../../app/api/artifacts/[id]/route";
import { POST as resumeInputPost } from "../../../app/api/routines/resume-input/route";
import { POST as callbackPost } from "../../../app/api/routines/artifacts/route";
import { POST as runPost } from "../../../app/api/routines/run/route";
import { getStore, setStoreForTests } from "../../runtime/store";
import { MemoryStore } from "../../runtime/store/memory";
import { FakeProducer, SAMPLE_ARTIFACT } from "../../runtime/__tests__/helpers";
import { setProducerForTests } from "../../../worker/service";
import { sign } from "../signing";
import { decideArtifact, decisionMemoryText } from "../handlers";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { listMemories } from "../../brain/memory";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://unc.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path: string) => new Request(`http://unc.test${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  setStoreForTests(store);
  setProducerForTests(new FakeProducer());
});
afterEach(() => {
  setStoreForTests(undefined);
  setProducerForTests(undefined);
  delete process.env.N8N_SIGNING_SECRET;
});

async function runOne() {
  const res = await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D01-W01" }));
  const { run } = await res.json();
  return run as { runId: string; status: string; artifact: { id: string } };
}

describe("GET /api/artifacts", () => {
  it("lists the account's artifacts newest first, filtered by routine, with previews", async () => {
    await runOne();
    await runOne();
    const res = await listGet(get("/api/artifacts?accountId=demo"));
    expect(res.status).toBe(200);
    const { artifacts, channels } = await res.json();
    expect(artifacts).toHaveLength(2);
    expect(channels).toEqual([]);
    expect(artifacts[0]).toMatchObject({ routineId: "D01-W01", routineName: "Founder content engine", category: "Content", kind: "post_set", status: "draft", editedBody: null });
    expect(artifacts[0].preview).toBe("Three posts drafted from the site profile and 3 customer questions.");
    expect((await (await listGet(get("/api/artifacts?accountId=demo&routineId=D05-W02"))).json()).artifacts).toEqual([]);
    expect((await listGet(get("/api/artifacts?routineId=nope"))).status).toBe(400);
    expect((await (await listGet(get("/api/artifacts?accountId=demo&limit=1"))).json()).artifacts).toHaveLength(1);
  });
});

describe("GET/POST /api/artifacts/<id>", () => {
  it("opens one; approve → status + taste_event; hold with a reason; edit keeps the original", async () => {
    const run = await runOne();
    const one = await oneGet(get(`/api/artifacts/${run.artifact.id}`), params(run.artifact.id));
    expect(one.status).toBe(200);
    expect((await one.json()).artifact.items).toHaveLength(3);
    expect((await oneGet(get("/api/artifacts/missing"), params("missing"))).status).toBe(404);

    const approved = await onePost(post(`/api/artifacts/${run.artifact.id}`, { action: "approve" }), params(run.artifact.id));
    expect(approved.status).toBe(200);
    const approvedBody = await approved.json();
    expect(approvedBody.artifact.status).toBe("approved");
    expect(approvedBody.receipt).toMatchObject({ kind: "notification", payload: { artifactDecision: true, artifactId: run.artifact.id, action: "approve", fromStatus: "draft", toStatus: "approved" } });
    const events = await getStore().listTasteEvents("demo");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "approved", routineId: "D01-W01", context: { artifactId: run.artifact.id, kind: "post_set" } });

    const run2 = await runOne();
    const held = await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "hold", reason: "too salesy" }), params(run2.artifact.id));
    expect((await held.json()).artifact.status).toBe("held");
    expect((await getStore().listTasteEvents("demo")).find((e) => e.action === "held")).toMatchObject({ context: { reason: "too salesy", artifactId: run2.artifact.id } });

    const edited = await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "edit", editedBody: "My own words." }), params(run2.artifact.id));
    const a = (await edited.json()).artifact;
    expect(a).toMatchObject({ status: "edited", editedBody: "My own words.", body: SAMPLE_ARTIFACT.body, preview: "My own words." });
    expect((await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "edit", editedBody: " " }), params(run2.artifact.id))).status).toBe(400);
    expect((await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "explode" }), params(run2.artifact.id))).status).toBe(400);
    expect((await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "send", channel: "fax" }), params(run2.artifact.id))).status).toBe(400);
    expect((await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "send", channel: "telegram" }), params(run2.artifact.id))).status).toBe(503); // no database in demo
    // why? opens are taste events too
    await onePost(post(`/api/artifacts/${run2.artifact.id}`, { action: "why" }), params(run2.artifact.id));
    expect((await getStore().listTasteEvents("demo")).some((e) => e.action === "why_opened")).toBe(true);
    const decisionReceipts = (await getStore().listReceipts("demo", { runId: run2.runId })).filter((r) => r.payload.artifactDecision === true);
    expect(decisionReceipts.map((r) => r.payload.action)).toEqual(["hold", "edit", "why"]);
  });

  it("decideArtifact writes the decision memory when a database is in hand", async () => {
    const run = await runOne();
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: "demo", name: "Demo", currency: "NZD" }]);
    const out = await decideArtifact({ store: getStore(), db }, { accountId: null, artifactId: run.artifact.id, action: "hold", reason: "wrong tone" });
    expect(out.memory).toBe("Held a post set from Founder content engine (“3 founder posts: why we ship from Auckland”): wrong tone.");
    const mem = await listMemories(db, "demo");
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ kind: "decision", source: "receipt", importance: 4, tags: ["artifact", "post_set", "d01-w01"] });
    const a = (await getStore().getArtifact(run.artifact.id))!;
    expect(decisionMemoryText(a, "approve")).toBe("Approved a post set from Founder content engine (“3 founder posts: why we ship from Auckland”).");
    expect(decisionMemoryText(a, "why")).toBeNull();
  });
});

describe("POST /api/routines/resume-input", () => {
  it("answers a waiting_input run and the produce step re-runs", async () => {
    setProducerForTests(new FakeProducer((_n, ctx) => (ctx.inputs?.about_the_business ? { artifact: { ...SAMPLE_ARTIFACT, title: `Posts about ${ctx.inputs.about_the_business}` } } : { needs: [{ input: "about_the_business", why: "tell me what you sell" }] })));
    const first = await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D01-W01" }));
    const { run } = await first.json();
    expect(run.status).toBe("waiting_input");
    expect(run.needs).toEqual([{ input: "about_the_business", why: "tell me what you sell" }]);
    expect(run.artifact).toBeNull();
    expect((await resumeInputPost(post("/api/routines/resume-input", { runId: run.runId, answers: "x" }))).status).toBe(400);
    expect((await resumeInputPost(post("/api/routines/resume-input", { runId: "missing", answers: { a: "b" } }))).status).toBe(404);
    expect((await resumeInputPost(post("/api/routines/resume-input", { runId: run.runId, answers: { "bad key": "b" } }))).status).toBe(400);
    const res = await resumeInputPost(post("/api/routines/resume-input", { runId: run.runId, answers: { about_the_business: "physio" } }));
    expect(res.status).toBe(200);
    const resumed = (await res.json()).run;
    expect(resumed).toMatchObject({ runId: run.runId, status: "done", artifact: { title: "Posts about physio" } });
    expect((await resumeInputPost(post("/api/routines/resume-input", { runId: run.runId, answers: { about_the_business: "again" } }))).status).toBe(409);
  });
});

describe("POST /api/routines/artifacts (n8n callback)", () => {
  it("503 without a secret; 401 on a bad signature; 409 for a run not waiting on n8n; delivers the artifact when signed", async () => {
    const body = JSON.stringify({ runId: "r", artifact: SAMPLE_ARTIFACT });
    expect((await callbackPost(post("/api/routines/artifacts", body))).status).toBe(503);
    process.env.N8N_SIGNING_SECRET = "s3cret";
    expect((await callbackPost(post("/api/routines/artifacts", body))).status).toBe(401);
    const signed = (b: string) => {
      const ts = String(Date.now());
      return post("/api/routines/artifacts", b, { "x-unc-signature": sign("s3cret", b, ts), "x-unc-timestamp": ts });
    };
    expect((await callbackPost(signed(JSON.stringify({ runId: "missing", artifact: SAMPLE_ARTIFACT })))).status).toBe(404);
    const done = await runOne();
    expect((await callbackPost(signed(JSON.stringify({ runId: done.runId, artifact: SAMPLE_ARTIFACT })))).status).toBe(409);

    // hand a run to n8n: register a workflow + a bridge that accepts
    await store.putN8nWorkflow({ id: "w", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/w", active: true });
    const { buildAdapters } = await import("../../../worker/service");
    const { runRoutine } = await import("../../runtime/engine");
    const { CATALOG_SPEC_BY_ID } = await import("../../runtime/catalog-specs");
    const { StaticAccountsSource } = await import("../../../worker/accounts");
    const { FixtureCredentialProvider } = await import("../../../worker/credentials");
    const adapters = { ...buildAdapters({ store, accounts: new StaticAccountsSource(), credentials: new FixtureCredentialProvider(), db: null }), n8n: { call: async () => ({ kind: "accepted" as const }) } };
    const held = await runRoutine(CATALOG_SPEC_BY_ID["D01-W01"], { account: { accountId: "demo", currency: "NZD", budgetMonthly: 0 }, triggeredBy: "manual" }, adapters, { mode: "dry_run" });
    expect(held.status).toBe("running");
    expect((await callbackPost(signed(JSON.stringify({ runId: held.runId, artifact: { kind: "post_set", title: "t", body: "b" } })))).status).toBe(400); // a post set needs items
    expect((await callbackPost(signed(JSON.stringify({ runId: held.runId, artifact: { ...SAMPLE_ARTIFACT, kind: "generic" } })))).status).toBe(400);
    const ok = await callbackPost(signed(JSON.stringify({ runId: held.runId, artifact: { ...SAMPLE_ARTIFACT, title: "From the workflow" } })));
    expect(ok.status).toBe(200);
    const { run } = await ok.json();
    expect(run).toMatchObject({ runId: held.runId, status: "done", artifact: { title: "From the workflow" } });
    expect((await store.getArtifact(run.artifact.id))!.meta.via).toBe("n8n");
  });
});
