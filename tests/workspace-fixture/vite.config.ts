import { defineConfig } from "vite";
import path from "node:path";
import { fixture } from "./data";
import { opsFixture, workFixture } from "../ops-fixture/data";
import { agentsFixture } from "../agents-fixture/data";
import { detailFixture,paramsFixture } from "../routine-detail-fixture/data";
import { manualFixture } from "../manual-recovery-fixture/server";
import { keywordFixture } from "../keyword-configuration-fixture/data";
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
      if (req.url === "/api/channels/slack/routes" && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({
        accountId:"aa5cfc84-2569-4c99-9b40-67003ae55eda",actorId:"74802c60-149a-4405-b719-dc058d174072",contextGeneration:1,paused:true,
        identities:[{identityLinkId:"22ebc4cc-5592-4404-b32f-e12c7b01c1cd",identityLinkVersion:2,workspaceId:"T1",workspaceName:"Synthetic team",botUserId:"UBOT",credentialStored:true}],
        routes:[{routeId:"44ebc4cc-5592-4404-b32f-e12c7b01c1cd",revision:0,workspaceId:"T1",conversationId:"C1",identityLinkId:"22ebc4cc-5592-4404-b32f-e12c7b01c1cd",identityLinkVersion:2,state:"active",verifiedAt:"2026-09-06T00:00:00Z",bindingCurrent:true}],activationAvailable:false,executedAction:"none"})); return; }
      if (req.url === "/api/routines/calendar-preferences" && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({accountId:"aa5cfc84-2569-4c99-9b40-67003ae55eda",actorId:"74802c60-149a-4405-b719-dc058d174072",contextGeneration:1,routineId:"D05-W07",timezone:null,updatedAt:null,canEdit:true,bound:false,paused:true,executedAction:"none"})); return; }
      if (req.url === "/api/routines/keyword-configuration" && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(keywordFixture)); return; }
      if (req.url?.startsWith("/api/agents?routineId=") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(detailFixture())); return; }
      if (req.url?.startsWith("/api/routines/params?") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(paramsFixture())); return; }
      if (req.url?.startsWith("/api/artifacts?") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({accountId:agentsFixture.accountId,contextGeneration:1,artifacts:[],channels:[]})); return; }
      if (req.url === "/api/agents" && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.headers.referer?.includes("/routine-detail-fixture/")?detailFixture():agentsFixture)); return; }
      if (req.url?.startsWith("/api/ops/run?")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(workFixture())); return; }
      if (req.url?.startsWith("/api/ops")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(opsFixture(new URL(req.url, "http://fixture.test").searchParams.get("accountId")))); return; }
      if (req.url?.startsWith("/api/workspace/history")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({accountId:fixture.accountId,contextGeneration:fixture.contextGeneration,
        asOf:fixture.fetchedAt,fetchedAt:fixture.fetchedAt,nextCursor:null,entries:[{kind:"artifact",id:fixture.artifacts[0].id,occurredAt:fixture.artifacts[0].createdAt,artifact:fixture.artifacts[0]}]})); return; }
      if (req.url === "/api/workspace") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(fixture)); return; }
      if (req.url?.startsWith("/api/")) { res.statusCode = 405; res.end("Fixture API not implemented"); return; }
      next();
    });
  } }],
});
