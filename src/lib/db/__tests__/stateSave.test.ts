import { describe, expect, it, vi } from "vitest";
import { accountInitialState } from "../../platform/state";
import { createAccountStateSaver, STATE_CONFLICT_MESSAGE, stateSaveRows } from "../stateSave";

const state = accountInitialState("NZD");
const reply = (revision: number, accountId = "account-a") => Response.json({ ok: true, accountId, revision });

describe("versioned account save client", () => {
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
