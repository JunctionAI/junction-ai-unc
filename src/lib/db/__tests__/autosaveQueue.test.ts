import { describe, expect, it, vi } from "vitest";
import { createAutosaveQueue } from "../autosaveQueue";

describe("autosave queue", () => {
  it("does not strand a resolved flight after a no-op save", async () => {
    const queue = createAutosaveQueue();
    await queue(async () => {});
    const save = vi.fn(async () => {});
    await queue(save);
    await queue(save);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("coalesces edits during a write and then allows later writes", async () => {
    const queue = createAutosaveQueue();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let latest = "first";
    const written: string[] = [];
    const save = async () => {
      written.push(latest);
      if (written.length === 1) await blocked;
    };
    const first = queue(save);
    await Promise.resolve();
    latest = "second";
    const second = queue(save);
    latest = "third";
    const third = queue(save);
    release();
    await Promise.all([first, second, third]);
    latest = "fourth";
    await queue(save);
    expect(written).toEqual(["first", "third", "fourth"]);
  });
  it("releases the flight after a failure so an explicit retry works", async () => {
    const queue = createAutosaveQueue();
    await expect(queue(async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    const retry = vi.fn(async () => {});
    await queue(retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});
