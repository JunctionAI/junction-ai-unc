import { describe, expect, it, vi } from "vitest";
import { accountInitialState } from "../../platform/state";
import { createAccountStateSaver, STATE_CONFLICT_MESSAGE, stateSaveRows } from "../stateSave";

const state = accountInitialState("NZD");
const reply = (revision: number, accountId = "account-a") => Response.json({ ok: true, accountId, revision });

describe("versioned account save client", () => {
  it("captures separate account headers for concurrent tabs and preserves them on an uncertain retry", async () => {
    const a = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(reply(1));
    const b = vi.fn().mockResolvedValue(reply(1, "account-b"));
    const saverA = createAccountStateSaver("account-a", 0, { fetch: a });
    const saverB = createAccountStateSaver("account-b", 0, { fetch: b });
    await expect(saverA.save(state)).rejects.toThrow("lost");
    await saverB.save(state); await saverA.save(state);
    expect(a.mock.calls.map(c => c[1].headers["x-unc-account-id"])).toEqual(["account-a", "account-a"]);
    expect(b.mock.calls[0][1].headers["x-unc-account-id"]).toBe("account-b");
    expect(a.mock.calls[0][1].body).toBe(a.mock.calls[1][1].body);
  });
  it("does not write or bump revision on hydration, view changes or a duplicate acknowledged save", async () => {
    const request = vi.fn().mockResolvedValue(reply(4));
    const saver = createAccountStateSaver("account-a", 3, { initialState: state, fetch: request });
    await saver.save(state);
    await saver.save({ ...state, view: "connectors" });
    expect(request).not.toHaveBeenCalled();
    expect(saver.revision).toBe(3);
    const edited = { ...state, website: "avgarsport.com" };
    await saver.save(edited);
    await saver.save(edited);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body).revision).toBe(3);
    expect(saver.revision).toBe(4);
  });
  it("reconciles an uncertain write even when edits revert to the hydration snapshot", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(reply(4)).mockResolvedValueOnce(reply(5));
    const saver = createAccountStateSaver("account-a", 3, { initialState: state, fetch: request });
    await expect(saver.save({ ...state, website: "avgarsport.com" })).rejects.toThrow("lost");
    await saver.save(state);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ revision: 4, rows: { resourceProfile: { website: null } } });
  });
  it("strips credential/runtime sections and serializes the initial revision", async () => {
    const request = vi.fn().mockResolvedValue(reply(4));
    const saver = createAccountStateSaver("account-a", 3, { fetch: request, id: () => "save-one" });
    await saver.save(state);
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body).toMatchObject({ accountId: "account-a", revision: 3, saveId: "save-one" });
    expect(body.rows).not.toHaveProperty("routineStates");
    expect(body.rows).not.toHaveProperty("connectors");
    expect(saver.revision).toBe(4);
  });
  it("reuses the identical request after a lost response, then saves newer edits at the acknowledged revision", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("network lost")).mockResolvedValueOnce(reply(1)).mockResolvedValueOnce(reply(2));
    const id = vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second");
    const saver = createAccountStateSaver("account-a", 0, { fetch: request, id });
    await expect(saver.save(state)).rejects.toThrow("network lost");
    await saver.save({ ...state, website: "avgarsport.com" });
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ revision: 1, saveId: "second", rows: { resourceProfile: { website: "avgarsport.com" } } });
    expect(saver.revision).toBe(2);
  });
  it("never upgrades a stale revision on conflict", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ code: "state_conflict" }, { status: 409 }));
    const saver = createAccountStateSaver("account-a", 2, { fetch: request, id: () => "same" });
    await expect(saver.save(state)).rejects.toThrow(STATE_CONFLICT_MESSAGE);
    await expect(saver.save({ ...state, website: "stale.invalid" })).rejects.toThrow(STATE_CONFLICT_MESSAGE);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(saver.revision).toBe(2);
  });
  it("does not accept a different account's response or a malformed revision", async () => {
    const request = vi.fn().mockResolvedValueOnce(reply(1, "other-account")).mockResolvedValueOnce(reply(9));
    const saver = createAccountStateSaver("account-a", 0, { fetch: request });
    await expect(saver.save(state)).rejects.toThrow("could not be verified");
    await expect(saver.save(state)).rejects.toThrow("could not be verified");
    expect(saver.revision).toBe(0);
  });
  it("does not add actor, approval or runtime identity to the payload", () => {
    const rows = stateSaveRows("account-a", { ...state, connState: { Shopify: "ok" }, routineOn: { "Founder content engine": true }, apStatus: ["approved"] });
    expect(Object.keys(rows).sort()).toEqual(["account", "businessProfile", "chatMessages", "goals", "plan", "resourceProfile", "stateMeta", "teamMembers"]);
  });
});
