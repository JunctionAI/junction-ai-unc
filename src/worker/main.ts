/* CLI entry for the worker daemon. See src/worker/README.md for the run
   command and flags. Everything wired here is dry-run, fixture-credential,
   refusing-executor; the only environment variable consulted is
   ANTHROPIC_API_KEY (by the SDK, optional — without it llm-rule decisions
   take their declared fallback). */

import { StaticAccountsSource } from "./accounts";
import { FixtureCredentialProvider } from "./credentials";
import { startHealthServer } from "./health";
import { createLogger } from "./log";
import { readHeartbeatFile, Worker } from "./loop";
import { createAnthropicLlmClient } from "./providers/llmDecision";
import { triggerRun, WORKER_RUN_MODE } from "./service";
import { getStore } from "../lib/runtime/store";
import { setEnabled } from "../lib/runtime/versioning";

export interface CliArgs {
  intervalSec: number;
  heartbeatPath: string;
  healthPort: number | null;
  once: boolean;
  enable: string[];
  /** Routines to dry-run immediately (manual trigger), regardless of schedule. */
  run: string[];
  accountId: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { intervalSec: 60, heartbeatPath: ".unc-worker/heartbeat.json", healthPort: null, once: false, enable: [], run: [], accountId: "demo" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--interval":
        args.intervalSec = Math.max(5, Number(next()) || 60);
        break;
      case "--heartbeat":
        args.heartbeatPath = next();
        break;
      case "--health-port":
        args.healthPort = Number(next()) || null;
        break;
      case "--once":
        args.once = true;
        break;
      case "--enable":
        args.enable = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--run":
        args.run = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--account":
        args.accountId = next();
        break;
      default:
        throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const log = createLogger(undefined, { worker: "unc", mode: WORKER_RUN_MODE });
  const store = getStore();
  const accounts = new StaticAccountsSource();
  const llm = createAnthropicLlmClient();
  log.info("worker.config", { ...args, llm: llm ? "anthropic (ANTHROPIC_API_KEY present)" : "none (fallback decisions)" });

  // Demo convenience: MemoryStore starts empty, so nothing is enabled until
  // something calls setEnabled. --enable D01-W01,D05-W02 flips those on.
  for (const routineId of args.enable) await setEnabled({ store }, args.accountId, routineId, true);

  const deps = { store, accounts, credentials: new FixtureCredentialProvider(), llm, log };
  const worker = new Worker(deps, { intervalSec: args.intervalSec, heartbeatPath: args.heartbeatPath });

  // Smoke test: --run D05-W02 dry-runs it now (manual trigger, same path as POST /api/routines/run).
  for (const routineId of args.run) {
    const result = await triggerRun(deps, { accountId: args.accountId, routineId, triggeredBy: "manual" }, worker.adapters);
    log.info("run.receipts", { routineId, runId: result.runId, status: result.status, receipts: result.receipts.map((r) => `[${r.kind}] ${r.description}`) });
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
