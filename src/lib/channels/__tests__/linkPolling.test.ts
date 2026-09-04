import { afterEach, describe, expect, it, vi } from "vitest";
import { pollLink } from "../linkPolling";

afterEach(() => vi.useRealTimers());
function setup(fetch = vi.fn<(_signal: AbortSignal) => Promise<boolean>>(async () => false), ttl = 600_000) {
  vi.useFakeTimers();
  const apply = vi.fn(); const finish = vi.fn();
  const stop = pollLink({ expiresAt: new Date(Date.now() + ttl).toISOString(), fetch, apply, finish, verified: v => v });
  return { fetch, apply, finish, stop };
}
describe("link polling", () => {
  it("expires without polling forever", async () => {
    const d = setup(undefined, 10_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.fetch).toHaveBeenCalledTimes(2);
    expect(d.finish).toHaveBeenCalledExactlyOnceWith("expired"); d.stop();
  });
  it("stops once the exact link is verified", async () => {
    const d = setup(vi.fn(async () => true));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.finish).toHaveBeenCalledExactlyOnceWith("linked"); d.stop();
  });
  it("backs off and pauses after three errors", async () => {
    const d = setup(vi.fn(async () => { throw new Error("offline"); }));
    await vi.advanceTimersByTimeAsync(100_000);
    expect(d.fetch).toHaveBeenCalledTimes(3);
    expect(d.finish).toHaveBeenCalledExactlyOnceWith("error"); d.stop();
  });
  it("never overlaps requests or applies an old response after cleanup", async () => {
    let resolve!: (v: boolean) => void;
    const fetch = vi.fn<(_signal: AbortSignal) => Promise<boolean>>(() => new Promise<boolean>(r => { resolve = r; }));
    const d = setup(fetch);
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetch).toHaveBeenCalledTimes(1);
    d.stop(); resolve(true); await Promise.resolve();
    expect(d.apply).not.toHaveBeenCalled(); expect(d.finish).not.toHaveBeenCalled();
  });
  it("rejects missing or invalid expiry without a request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(); const finish = vi.fn();
    const stop = pollLink({ expiresAt: null, fetch, verified: () => false, apply: vi.fn(), finish });
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).not.toHaveBeenCalled(); expect(finish).toHaveBeenCalledWith("expired"); stop();
  });
});
