/* CLI entry for the worker daemon. See src/worker/README.md for the run
   command and flags. Everything wired here is dry-run + refusing-executor.
   Credentials and accounts come from wiring.ts: real tokens + DB accounts when
   Supabase (service role) and CONNECTOR_SECRET_KEY are configured, fixture
   markers + the static `demo` account otherwise. Model provider keys (ANTHROPIC_API_KEY,
   OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, LLM_CUSTOM_BASE_URL — see
   docs/MODELS.md) are read by the model layer (optional — without any, llm-rule decisions
   take their declared fallback and the self-review is deterministic). */

import { startHealthServer } from "./health";
import { createLogger } from "./log";
import { readHeartbeatFile, Worker } from "./loop";
import { createLlmClient, describeLlmClient } from "./providers/llmDecision";
import { createTextClient } from "../lib/llm/router";
import { SELF_REVIEW_EFFORT, SELF_REVIEW_MAX_TOKENS } from "../lib/telemetry/selfReview";
import { triggerRun, WORKER_RUN_MODE } from "./service";
import { parseArgs } from "./cli";
import { runBenchmarks, runMeasure, runSelfReview } from "./telemetry";
import { getStore } from "../lib/runtime/store";
import { setEnabled } from "../lib/runtime/versioning";
import { defaultAccountsSource, defaultCredentialProvider, describeWiring, serviceDb } from "./wiring";

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const log = createLogger(undefined, { worker: "unc", mode: WORKER_RUN_MODE });
  const store = getStore();
  const accounts = defaultAccountsSource();
  const llm = createLlmClient();
  const reviewLlm = createTextClient("self_review", { maxTokens: SELF_REVIEW_MAX_TOKENS, effort: SELF_REVIEW_EFFORT, jsonMode: true });
  log.info("worker.config", { ...args, ...describeWiring(), llm: describeLlmClient() });

  // Demo convenience: MemoryStore starts empty, so nothing is enabled until
  // something calls setEnabled. --enable D01-W01,D05-W02 flips those on.
  for (const routineId of args.enable) await setEnabled({ store }, args.accountId, routineId, true);

  const db = serviceDb();
  const deps = { store, accounts, credentials: defaultCredentialProvider(process.env, (line) => log.info("credentials", { line })), llm, reviewLlm, log, db };
  // The daemon runs the telemetry jobs itself at their UTC slots (src/worker/jobs.ts); the
  // one-shot flags below stay for manual / catch-up runs.
  const worker = new Worker(deps, { intervalSec: args.intervalSec, heartbeatPath: args.heartbeatPath });

  // Smoke test: --run D05-W02 dry-runs it now (manual trigger, same path as POST /api/routines/run).
  for (const routineId of args.run) {
    const result = await triggerRun(deps, { accountId: args.accountId, routineId, triggeredBy: "manual" }, worker.adapters);
    log.info("run.receipts", { routineId, runId: result.runId, status: result.status, receipts: result.receipts.map((r) => `[${r.kind}] ${r.description}`) });
  }

  // Telemetry one-shots (the "improves over time" loops). Each runs across the accounts
  // source (or --account) and the process exits afterwards, like --once.
  if (args.measure || args.selfReview || args.benchmarks) {
    const telemetry = { store, accounts, reader: worker.adapters.reader, db, llm: reviewLlm, log };
    const only = args.accountGiven ? args.accountId : undefined;
    if (args.measure) {
      const r = await runMeasure(telemetry, { accountId: only });
      log.info("worker.measure", { accounts: r.accounts, measured: r.measured, skipped: r.skipped });
    }
    if (args.selfReview) {
      const r = await runSelfReview(telemetry, { accountId: only });
      log.info("worker.self_review", { accounts: r.accounts, written: r.written, alreadyDone: r.alreadyDone });
    }
    if (args.benchmarks) {
      const r = await runBenchmarks(telemetry);
      log.info("worker.benchmarks", { ...r });
    }
    if (!args.once) return;
  }

  if (args.once) {
    const report = await worker.tick();
    log.info("worker.once", { started: report.started, deferred: report.deferred });
    return;
  }

  if (args.healthPort) {
    await startHealthServer(args.healthPort, () => readHeartbeatFile(args.heartbeatPath), { maxAgeMs: args.intervalSec * 1000 * 3 });
    log.info("health.listening", { port: args.healthPort });
  }
  worker.start();
}

runCli().catch((err) => {
  process.stderr.write(JSON.stringify({ level: "error", event: "worker.fatal", error: err instanceof Error ? err.message : String(err) }) + "\n");
  process.exit(1);
});
