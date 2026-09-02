/* CLI argument parsing for the worker daemon — split from main.ts so tests can import it
   without starting the worker (main.ts calls runCli() at module load). Flags are documented
   in src/worker/README.md; the telemetry one-shots in docs/IMPROVEMENT-LOOP.md. */

export interface CliArgs {
  intervalSec: number;
  heartbeatPath: string;
  healthPort: number | null;
  once: boolean;
  enable: string[];
  /** Routines to dry-run immediately (manual trigger), regardless of schedule. */
  run: string[];
  accountId: string;
  /** True when --account was passed explicitly (telemetry jobs then target that one account). */
  accountGiven: boolean;
  /** Telemetry one-shots (docs/IMPROVEMENT-LOOP.md): run, then exit like --once. */
  measure: boolean;
  selfReview: boolean;
  benchmarks: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { intervalSec: 60, heartbeatPath: ".unc-worker/heartbeat.json", healthPort: null, once: false, enable: [], run: [], accountId: "demo", accountGiven: false, measure: false, selfReview: false, benchmarks: false };
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
        args.accountGiven = true;
        break;
      case "--measure":
        args.measure = true;
        break;
      case "--self-review":
        args.selfReview = true;
        break;
      case "--benchmarks":
        args.benchmarks = true;
        break;
      default:
        throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

