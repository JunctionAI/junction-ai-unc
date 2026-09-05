import { describe, expect, it, vi } from "vitest";
import { createThreadPoller, mergeThread, threadIdentityKey, visibleThreadRows, type ThreadRow } from "../useChannelThread";

const identity = { accountId: "a", contextGeneration: 2 };
const row = (id: string, channel: ThreadRow["channel"] = "sms"): ThreadRow => ({ id, channel, at: "2026-09-05T01:00:00Z", sender: "user", body: id });
const response = (messages: ThreadRow[]) => Response.json({ ...identity, messages });

describe("captured conversation polling", () => {
  it("retains app anchors and re-reads late commits without a wall-clock cursor or duplicate rows", async () => {
    const snapshots: ThreadRow[][] = [];
    const rows = [row("app", "app"), row("sms")];
    const fetcher = vi.fn().mockResolvedValueOnce(response(rows)).mockResolvedValueOnce(response([row("late"), ...rows]));
    const poller = createThreadPoller(identity, r => snapshots.push(r), fetcher);
    await poller.pull(); await poller.pull();
    expect(snapshots[0]).toEqual(rows);
    expect(snapshots[1].map(r => r.id)).toEqual(["late", "app", "sms"]);
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toBe("/api/channels/thread?limit=500");
      expect(call[1].headers).toEqual({ "x-unc-account-id": "a", "x-unc-context-generation": "2" });
    }
  });

  it("disposal rejects a late response even if the transport ignores abort; overlapping polls cannot race", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const accept = vi.fn();
    const poller = createThreadPoller(identity, accept, fetcher);
    const pending = poller.pull();
    await poller.pull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    poller.dispose();
    resolve(response([row("old")]));
    await pending;
    expect(accept).not.toHaveBeenCalled();
  });

  it("masks another account or generation immediately, including signed-out render", () => {
    const snapshot = { key: threadIdentityKey(identity), rows: [row("private")] };
    expect(visibleThreadRows(snapshot, snapshot.key)).toEqual(snapshot.rows);
    expect(visibleThreadRows(snapshot, threadIdentityKey({ ...identity, accountId: "b" }))).toEqual([]);
    expect(visibleThreadRows(snapshot, threadIdentityKey({ ...identity, contextGeneration: 3 }))).toEqual([]);
    expect(visibleThreadRows(snapshot, null)).toEqual([]);
  });

  it.each([401, 403, 409, 503])("clears the snapshot when the server refuses its identity/read (%s)", async status => {
    const accept = vi.fn();
    await createThreadPoller(identity, accept, vi.fn().mockResolvedValue(Response.json({}, { status }))).pull();
    expect(accept).toHaveBeenCalledWith([]);
  });

  it.each([{ accountId: "b", contextGeneration: 2 }, { accountId: "a", contextGeneration: 3 }, {}])("rejects a mismatched or unbound successful response: %j", async returned => {
    const accept = vi.fn();
    await createThreadPoller(identity, accept, vi.fn().mockResolvedValue(Response.json({ ...returned, messages: [row("wrong")] }))).pull();
    expect(accept).toHaveBeenCalledWith([]);
  });

  it("positions a bounded history tail using absolute app positions, not snapshot row count", () => {
    const local = Array.from({ length: 600 }, (_, i) => `local ${i}`);
    const remote = [{ ...row("anchor", "app"), appPosition: 599 }, { ...row("remote"), at: "2026-09-05T01:01:00Z" }];
    const merged = mergeThread(local, remote, r => r.body, 0);
    expect(merged.slice(-2)).toEqual(["local 599", "remote"]);
  });
});
