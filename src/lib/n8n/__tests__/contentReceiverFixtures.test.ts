/** Simulated frozen-receiver pack. No live n8n, DataForSEO or SQL. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentShadowArtifact, validateContentShadowReceipt } from "../contentShadowContract";
import { CONTENT_MARKETS_LIST, CONTENT_RECEIVER_STATUS, CONTENT_ROUTINE_LIST, FROZEN_CLOCK,
  frozenAuthorityErrors, frozenAuthorityHttp, frozenAuthoritySuccess, frozenContract, frozenNeedsEmpty,
  frozenRequest, frozenResponse } from "../contentReceiverFixtures";
import { contentApprovalFromSavedSchedule, CONTENT_SCHEDULE_REUSE } from "../contentSchedule";

const dir = path.resolve(__dirname, "../../../../docs/integration/receivers/content-search-shadow.v1");
const now = () => new Date("2026-09-06T12:00:03.000Z");

describe("frozen Content receiver pack (simulated; unpublished URLs)", () => {
  it("keeps proposed receivers distinct from published keyword and historical TEST workflows", () => {
    expect(CONTENT_RECEIVER_STATUS.hooksReceiver.status).toBe("proposed_unpublished");
    expect(CONTENT_RECEIVER_STATUS.questionsReceiver.status).toBe("proposed_unpublished");
    expect(CONTENT_RECEIVER_STATUS.keywordWrapper.receiverUrl).toContain("d03-w01/keyword-shadow");
    expect(CONTENT_RECEIVER_STATUS.historicalContentTest.execution).toBe("68");
    expect(CONTENT_RECEIVER_STATUS.wrapperId).not.toBe(CONTENT_RECEIVER_STATUS.historicalContentTest.workflowId);
    expect(CONTENT_RECEIVER_STATUS.wrapperId).not.toBe(CONTENT_RECEIVER_STATUS.keywordWrapper.workflowId);
  });
  it.each(CONTENT_ROUTINE_LIST.flatMap((routineId) => CONTENT_MARKETS_LIST.map((market) => [routineId, market] as const)))(
    "%s %s request/response pass Unc validators and stay on golf travel bag", (routineId, market) => {
      const request = frozenRequest(routineId, market);
      const response = frozenResponse(routineId, market);
      const contract = frozenContract(routineId, market);
      const identity = { accountId: contract.accountId, runId: request.body.runId, routineId, mode: "dry_run" as const, startedAt: FROZEN_CLOCK.startedAt };
      expect(request.body.shadow.client.seedKeyword).toBe("golf travel bag");
      expect(request.body.kind).toBe(routineId === "D01-W02" ? "hook_list" : "question_list");
      expect(request.body.data.scopes).toEqual([]);
      expect(contentShadowArtifact(response.artifact, contract, identity).items!.length).toBeGreaterThan(0);
      expect(validateContentShadowReceipt(response.executionReceipt, contract, identity, now()).provider).toMatchObject({
        name: "dataforseo", locationCode: contract.client.locationCode, seedKeyword: "golf travel bag",
      });
      expect(JSON.parse(readFileSync(path.join(dir, `${routineId}-${market}.request.json`), "utf8"))).toEqual(request);
      expect(JSON.parse(readFileSync(path.join(dir, `${routineId}-${market}.response.json`), "utf8"))).toEqual(response);
      expect(JSON.parse(readFileSync(path.join(dir, `${routineId}-${market}.authority-200.json`), "utf8"))).toEqual(frozenAuthoritySuccess(routineId, market));
      expect(frozenAuthoritySuccess(routineId, market).doNotCall).toContain("shadow-authority");
      expect(frozenAuthoritySuccess(routineId, market).url).toContain("content-shadow-authority");
      expect(request.proposedReceiverUrl).not.toBe(CONTENT_RECEIVER_STATUS.keywordWrapper.receiverUrl);
      expect(contract.client.locationCode).toBe(market === "US" ? 2840 : market === "NZ" ? 2554 : 2036);
    });
  it("empty SERP is needs, not invented copy; disk pack is complete", () => {
    expect(frozenNeedsEmpty().needs[0].input).toBe("search_results");
    expect(frozenAuthorityHttp().method).toBe("POST");
    expect(frozenAuthorityHttp().body).toBeNull();
    expect(frozenAuthorityErrors().get.status).toBe(405);
    expect(frozenAuthorityErrors().replay.status).toBe(409);
    const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    expect(names).toContain("needs.empty-serp.json");
    expect(JSON.parse(readFileSync(path.join(dir, "authority.http.json"), "utf8"))).toEqual(frozenAuthorityHttp());
    expect(JSON.parse(readFileSync(path.join(dir, "authority.errors.json"), "utf8"))).toEqual(frozenAuthorityErrors());
    expect(JSON.parse(readFileSync(path.join(dir, "published-versus-proposed.json"), "utf8"))).toEqual(CONTENT_RECEIVER_STATUS);
    expect(names).toContain("authority.http.json");
    expect(names).toContain("authority.errors.json");
    expect(names).toContain("published-versus-proposed.json");
    expect(names.filter((n) => n.endsWith(".request.json"))).toHaveLength(6);
    expect(names.filter((n) => n.endsWith(".response.json"))).toHaveLength(6);
    expect(names.filter((n) => n.endsWith(".authority-200.json"))).toHaveLength(6);
  });
});

describe("Content reuses saved schedules (no Monday 08:00 loop)", () => {
  it("does not assume catalog WEEKLY_MON and maps a claimed saved slot onto admission", () => {
    expect(CONTENT_SCHEDULE_REUSE.doNotAssume).toEqual({ weekday: 1, hour: 8, cadence: "0 8 * * 1" });
    expect(CONTENT_SCHEDULE_REUSE.table).toBe("routine_schedules");
    expect(CONTENT_SCHEDULE_REUSE.timing).toContain("customer-selected");
    expect(CONTENT_RECEIVER_STATUS.keywordScheduleProof.n8nExecution).toBe("100");
    expect(CONTENT_RECEIVER_STATUS.keywordScheduleProof.status).toBe("published_keyword_only");
    const approval = contentApprovalFromSavedSchedule({
      scheduleId: "c0a1e000-0000-4000-8000-00000000d102", revision: 0, localDate: "2026-09-06",
      slotAt: "2026-09-06T03:30:00.000Z", routineId: "D01-W02", market: "US", contextGeneration: 1,
      enabled: true, timezone: "Pacific/Auckland",
    }, "74802c60-149a-4405-b719-dc058d174072", now());
    expect(approval.idempotencyKey).toBe("schedule:c0a1e000-0000-4000-8000-00000000d102:0:2026-09-06");
    expect(approval.routineId).toBe("D01-W02");
    expect(approval.idempotencyKey).not.toContain(CONTENT_RECEIVER_STATUS.keywordScheduleProof.scheduleId);
    expect(() => contentApprovalFromSavedSchedule({
      scheduleId: "x", revision: 0, localDate: "2026-09-06", slotAt: "2026-09-06T03:30:00.000Z",
      routineId: "D01-W02", market: "US", contextGeneration: 1, enabled: false, timezone: "UTC",
    }, "74802c60-149a-4405-b719-dc058d174072", now())).toThrow(/switched off/);
  });
});
