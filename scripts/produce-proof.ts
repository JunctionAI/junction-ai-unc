/* One real end-to-end proof of the produce step, with NO database and NO writes:
   the Founder content engine skill (D01-W01) through the real LlmProducer (router task
   routine_produce) against a fixture business profile + three memories, printed.

     set -a; source <your .env>; set +a      # a provider key; never printed
     npx tsc -p scripts/proof/tsconfig.json && node dist/proof/scripts/produce-proof.js [routineId]

   Optional: PROOF_ABOUT="…" seeds inputs.about_the_business; PROOF_JSON=1 prints the JSON. */

import { skillFor } from "../src/lib/runtime/skills";
import type { ProduceNode, RunContext } from "../src/lib/runtime/types";
import { createProducerClient, LlmProducer, type ProducerContextSource } from "../src/worker/providers/producer";
import { describeLlm } from "../src/lib/llm/router";

const routineId = process.argv[2] ?? "D01-W01";
const skill = skillFor(routineId);
if (!skill) {
  process.stderr.write(`no skill card for ${routineId}\n`);
  process.exit(1);
}

const FIXTURE: ProducerContextSource = {
  gather: async () => ({
    profile: {
      name: "Harbour Physio",
      oneLiner: "Sports physiotherapy for runners and gym-goers on Auckland's North Shore",
      category: "Health services (physiotherapy)",
      products: ["ACC-funded physio appointments", "Running assessments", "Strength & return-to-sport programmes", "Saturday clinic"],
      audience: "Runners, gym-goers and weekend athletes aged 25–55 who want to get back to training, not just out of pain",
      voice: { tone: "plain, warm, direct — no medical jargon", phrases: ["get you back out there", "we treat the runner, not the knee", "no referral needed"] },
      market: { region: "North Shore, Auckland, NZ", competitorsMentioned: [] },
      signals: ["FAQ: Do I need a GP referral? No.", "Open Saturdays 8–1", "ACC accepted", "Founded 2015 by two physios who run"],
      confidence: "medium",
      sources: ["https://harbourphysio.test"],
    },
    memories: ["[fact] About 40% of clients are runners; the rest are gym injuries and post-surgery rehab", "[preference] Founder wants posts that sound like a conversation at the clinic desk, never like an ad", "[constraint] Never promise a cure or a timeline for recovery", "[event 2026-10-25] Auckland Marathon — clinic runs a free gait-check tent"],
    goal: { title: "NZ$40,000 MRR", deadline: "2026-12-31", baseline: 28000, currency: "NZD" },
    plan: [{ title: "Content — your strength, running first", channel: "Content" }],
    priorArtifacts: [],
    founderNotes: "Short and human. I'd rather three honest lines than a polished paragraph.",
  }),
};

const ctx: RunContext = {
  runId: "proof-run",
  routineId,
  version: 1,
  mode: "dry_run",
  startedAt: new Date().toISOString(),
  account: { accountId: "proof", currency: "NZD", budgetMonthly: 1500, approver: "Sam" },
  caps: { currency: "NZD", perDay: 50, perMonth: 1500 },
  triggeredBy: "manual",
  vars: { website: "harbourphysio.test" },
  inputs: process.env.PROOF_ABOUT ? { about_the_business: process.env.PROOF_ABOUT } : {},
  reads: {
    questions: { rows: [{ subject: "Do I need a referral to book?" }, { subject: "Is a running assessment worth it if I'm not injured?" }, { subject: "Can I claim this on ACC?" }, { subject: "How many sessions will my knee take?" }], metrics: {}, fetchedAt: new Date().toISOString(), provenance: "ok" },
    posts: { rows: [], metrics: {}, fetchedAt: new Date().toISOString(), provenance: "unavailable" },
    products: { rows: [], metrics: {}, fetchedAt: new Date().toISOString(), provenance: "unavailable" },
  },
  checks: {},
};

async function main() {
  const client = createProducerClient({ db: null });
  process.stdout.write(`model: ${describeLlm()}\n`);
  if (!client) {
    process.stderr.write("no provider configured — source a key first\n");
    process.exit(2);
  }
  const producer = new LlmProducer(client, { context: FIXTURE, playbooks: null });
  const node: ProduceNode = { kind: "produce", id: "produce", skill: routineId, maxItems: skill!.maxItems };
  const t0 = Date.now();
  const out = await producer.produce(node, ctx);
  process.stdout.write(`took ${Math.round((Date.now() - t0) / 100) / 10}s\n\n`);
  if ("needs" in out) {
    process.stdout.write(`WAITING_INPUT: ${out.needs.map((n) => `${n.platform ?? n.input}: ${n.why}`).join("; ")}${out.note ? `\n${out.note}` : ""}\n`);
    return;
  }
  const a = out.artifact;
  if (process.env.PROOF_JSON) {
    process.stdout.write(JSON.stringify(a, null, 2) + "\n");
    return;
  }
  process.stdout.write(`# ${a.title}\n\n${a.body}\n\n`);
  for (const [i, it] of (a.items ?? []).entries()) process.stdout.write(`## ${i + 1}. ${it.title}\n${it.body}\n${it.meta ? `_${JSON.stringify(it.meta)}_\n` : ""}\n`);
  process.stdout.write(`evidence: ${(a.evidence ?? []).map((e) => `${e.source}: ${e.ref}`).join(" | ")}\nmeta: ${JSON.stringify(a.meta)}\n`);
}

main().catch((err) => {
  process.stderr.write(`proof failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
