/** Bounded, serial polling. A stopped/expired request can never complete a newer handshake. */
export function pollLink<T>(opts: {
  expiresAt: string | null | undefined;
  fetch: (signal: AbortSignal) => Promise<T>;
  verified: (value: T) => boolean;
  apply: (value: T) => void;
  finish: (state: "linked" | "expired" | "error") => void;
  intervalMs?: number;
}) {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  let request: AbortController | undefined;
  const deadline = Date.parse(opts.expiresAt ?? "");
  const remaining = () => Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
  const stop = () => { stopped = true; clearTimeout(timer); clearTimeout(expiry); request?.abort(); };
  const finish = (state: "linked" | "expired" | "error") => { if (stopped) return; stop(); opts.finish(state); };
  const expiry = setTimeout(() => finish("expired"), remaining());
  async function tick() {
    if (stopped) return;
    if (!remaining()) { finish("expired"); return; }
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 10_000);
    try {
      const value = await opts.fetch(request.signal);
      if (stopped) return;
      if (!remaining()) { finish("expired"); return; }
      opts.apply(value);
      failures = 0;
      if (opts.verified(value)) { finish("linked"); return; }
    } catch {
      if (stopped) return;
      if (++failures >= 3) { finish("error"); return; }
    } finally { clearTimeout(timeout); }
    if (!stopped) timer = setTimeout(tick, Math.min((opts.intervalMs ?? 4000) * 2 ** failures, remaining()));
  }
  timer = setTimeout(tick, Math.min(opts.intervalMs ?? 4000, remaining()));
  return () => { clearTimeout(expiry); stop(); };
}
