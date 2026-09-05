import { defineConfig } from "vite";
import path from "node:path";
import { fixture } from "./data";
import { opsFixture } from "../ops-fixture/data";
import { agentsFixture } from "../agents-fixture/data";
import { detailFixture,paramsFixture } from "../routine-detail-fixture/data";
import { manualFixture } from "../manual-recovery-fixture/server";
const root = path.resolve(__dirname, "../..");
export default defineConfig({
  root, envDir: false,
  resolve: { alias: [
    { find: "@/lib/unc/accountFacts", replacement: path.join(root, "tests/workspace-fixture/facts.ts") },
    { find: "next/link", replacement: path.join(root, "tests/workspace-fixture/link.tsx") },
    { find: "@", replacement: path.join(root, "src") },
  ] },
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  plugins: [{ name: "isolated-workspace-fixture", configureServer(server) {
    server.middlewares.use(manualFixture());
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/api/agents?routineId=") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(detailFixture())); return; }
      if (req.url?.startsWith("/api/routines/params?") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(paramsFixture())); return; }
      if (req.url?.startsWith("/api/artifacts?") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({accountId:agentsFixture.accountId,contextGeneration:1,artifacts:[],channels:[]})); return; }
      if (req.url === "/api/agents" && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.headers.referer?.includes("/routine-detail-fixture/")?detailFixture():agentsFixture)); return; }
      if (req.url?.startsWith("/api/ops")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(opsFixture(new URL(req.url, "http://fixture.test").searchParams.get("accountId")))); return; }
      if (req.url === "/api/workspace") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(fixture)); return; }
      if (req.url?.startsWith("/api/")) { res.statusCode = 405; res.end("Fixture API not implemented"); return; }
      next();
    });
  } }],
});
