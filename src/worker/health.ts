/* Optional HTTP health endpoint for the daemon (Fly.io checks hit it).
   GET /health → 200 when the heartbeat is fresh, 503 otherwise. Nothing else
   is served; nothing from the request is echoed. */

import { createServer, type Server } from "node:http";
import type { BriefMarkers, JobMarkers } from "./jobs";

export interface Heartbeat {
  pid: number;
  startedAt: string;
  lastTickAt: string | null;
  lastTickMs: number | null;
  ticks: number;
  runsStarted: number;
  mode: "dry_run";
  liveModeEnabled: false;
  stopping: boolean;
  /** Per-job "already ran" markers for the in-loop scheduler (jobs.ts); reloaded on start. */
  jobs?: JobMarkers;
  /** Per-account "already briefed today" markers (account-local days); reloaded on start. */
  briefs?: BriefMarkers;
  lastSweepAt?: string | null;
  lastError?: string;
}

export function heartbeatIsFresh(hb: Heartbeat | null, now: Date, maxAgeMs: number): boolean {
  if (!hb || hb.stopping) return false;
  const stamp = hb.lastTickAt ?? hb.startedAt;
  return now.getTime() - new Date(stamp).getTime() <= maxAgeMs;
}

export function startHealthServer(port: number, read: () => Heartbeat | null, opts: { maxAgeMs: number; now?: () => Date; host?: string }): Promise<Server> {
  const now = opts.now ?? (() => new Date());
  const server = createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404).end();
      return;
    }
    const hb = read();
    const fresh = heartbeatIsFresh(hb, now(), opts.maxAgeMs);
    res.writeHead(fresh ? 200 : 503, { "content-type": "application/json" });
    const sha = /^[a-f0-9]{40}$/.test(process.env.UNC_BUILD_SHA ?? "") ? process.env.UNC_BUILD_SHA : null;
    res.end(JSON.stringify({ ok: fresh, build: { sha }, heartbeat: hb }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, opts.host ?? "0.0.0.0", () => resolve(server));
  });
}
