import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIp, handleWaitlist } from "../handler";
import { normalizeCountryHeader, normalizeEmail, normalizeSource, RateLimiter, recordWaitlist, type WaitlistEntry, type WaitlistSinks } from "../store";

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({ email: "founder@example.test", country: "NZ", source: "hero", referrer: null, createdAt: "2026-09-02T09:00:00.000Z", ...over });

describe("normalizeEmail", () => {
  it("accepts a plain address, trimmed and lower-cased", () => {
    expect(normalizeEmail("  Founder@Example.TEST ")).toBe("founder@example.test");
    expect(normalizeEmail("a.b+tag@sub.domain.co.nz")).toBe("a.b+tag@sub.domain.co.nz");
  });
  it("rejects junk", () => {
    for (const bad of ["", "   ", "nope", "no@tld", "@x.com", "a@b.c", "two words@x.com", "a@@b.com", 42, null, undefined, {}]) expect(normalizeEmail(bad)).toBeNull();
    expect(normalizeEmail("a".repeat(250) + "@x.com")).toBeNull();
  });
});

describe("normalizeSource / normalizeCountryHeader", () => {
  it("keeps short tokens only", () => {
    expect(normalizeSource("hero")).toBe("hero");
    expect(normalizeSource("pricing-card_2")).toBe("pricing-card_2");
    expect(normalizeSource("<script>")).toBeNull();
    expect(normalizeSource("")).toBeNull();
    expect(normalizeSource(7)).toBeNull();
  });
  it("country is two upper-case letters or nothing", () => {
    expect(normalizeCountryHeader("nz")).toBe("NZ");
    expect(normalizeCountryHeader("AU")).toBe("AU");
    expect(normalizeCountryHeader("")).toBeNull();
    expect(normalizeCountryHeader(null)).toBeNull();
    expect(normalizeCountryHeader("NZL")).toBeNull();
  });
});

describe("RateLimiter — fixed window per key", () => {
  it("allows `limit` hits per window, then refuses until the window rolls", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.hit("ip", 0)).toBe(true);
    expect(rl.hit("ip", 10)).toBe(true);
    expect(rl.hit("ip", 20)).toBe(true);
    expect(rl.hit("ip", 30)).toBe(false);
    expect(rl.hit("other", 30)).toBe(true);
    expect(rl.hit("ip", 999)).toBe(false);
    expect(rl.hit("ip", 1000)).toBe(true);
  });
  it("defaults to 10 / minute", () => {
    const rl = new RateLimiter();
    expect(rl.limit).toBe(10);
    expect(rl.windowMs).toBe(60_000);
  });
});

describe("recordWaitlist — the sink cascade", () => {
  const calls: string[] = [];
  const ok = (name: string) => async () => {
    calls.push(name);
  };
  const boom = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} down`);
  };
  const quiet = () => {};
  beforeEach(() => (calls.length = 0));

  it("db first when configured", async () => {
    const r = await recordWaitlist(entry(), { db: ok("db"), email: ok("email"), file: ok("file") }, quiet);
    expect(r).toEqual({ stored: "db", duplicate: false, failed: [] });
    expect(calls).toEqual(["db"]);
  });
  it("db duplicate counts as recorded (no fall-through)", async () => {
    const r = await recordWaitlist(entry(), { db: async () => "duplicate", email: ok("email"), file: ok("file") }, quiet);
    expect(r).toEqual({ stored: "db", duplicate: true, failed: [] });
    expect(calls).toEqual([]);
  });
  it("no db → email", async () => {
    const r = await recordWaitlist(entry(), { db: null, email: ok("email"), file: ok("file") }, quiet);
    expect(r.stored).toBe("email");
    expect(calls).toEqual(["email"]);
  });
  it("no db, no email → file", async () => {
    const r = await recordWaitlist(entry(), { db: null, email: null, file: ok("file") }, quiet);
    expect(r.stored).toBe("file");
    expect(calls).toEqual(["file"]);
  });
  it("a failing sink falls through to the next and is reported", async () => {
    const logs: string[] = [];
    const r = await recordWaitlist(entry(), { db: boom("db"), email: boom("email"), file: ok("file") }, (m) => logs.push(m));
    expect(r).toEqual({ stored: "file", duplicate: false, failed: ["db", "email"] });
    expect(calls).toEqual(["db", "email", "file"]);
    expect(logs).toEqual(["[waitlist] db sink failed: db down", "[waitlist] email sink failed: email down"]);
  });
  it("never throws even when everything fails", async () => {
    const r = await recordWaitlist(entry(), { db: boom("db"), email: null, file: boom("file") }, quiet);
    expect(r).toEqual({ stored: null, duplicate: false, failed: ["db", "file"] });
  });
});

describe("handleWaitlist — the route contract", () => {
  let sinks: WaitlistSinks;
  let stored: WaitlistEntry[];
  let limiter: RateLimiter;
  const post = (body: unknown, headers: Record<string, string> = {}, raw = false) =>
    new Request("https://unc.example.test/api/waitlist", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ? (body as string) : JSON.stringify(body) });
  const deps = () => ({ sinks, limiter, now: () => new Date("2026-09-02T09:00:00.000Z"), log: () => {} });

  beforeEach(() => {
    stored = [];
    sinks = {
      db: async (e) => {
        stored.push(e);
      },
      email: null,
      file: async () => {
        throw new Error("should not reach file");
      },
    };
    limiter = new RateLimiter(10, 60_000);
  });

  it("valid email → 200 { ok:true } and the entry is recorded with country + source + referrer", async () => {
    const res = await handleWaitlist(post({ email: "Founder@Example.test", source: "hero" }, { "x-vercel-ip-country": "nz", referer: "https://getjunction.ai/" }), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(stored).toEqual([{ email: "founder@example.test", country: "NZ", source: "hero", referrer: "https://getjunction.ai/", createdAt: "2026-09-02T09:00:00.000Z" }]);
  });
  it("defaults source to 'landing' and country/referrer to null when absent", async () => {
    await handleWaitlist(post({ email: "a@b.co" }), deps());
    expect(stored[0]).toMatchObject({ source: "landing", country: null, referrer: null });
  });
  it("invalid email → 400 { ok:false, error:'invalid_email' }; nothing recorded", async () => {
    for (const body of [{ email: "nope" }, { email: "" }, {}, { email: 5 }]) {
      const res = await handleWaitlist(post(body), deps());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_email" });
    }
    const res = await handleWaitlist(post("not json", {}, true), deps());
    expect(res.status).toBe(400);
    expect(stored).toEqual([]);
  });
  it("rate-limits by IP: the 11th request in a minute is 429; another IP is unaffected", async () => {
    for (let i = 0; i < 10; i++) expect((await handleWaitlist(post({ email: `f${i}@x.co` }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), deps())).status).toBe(200);
    const res = await handleWaitlist(post({ email: "f11@x.co" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), deps());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    expect((await handleWaitlist(post({ email: "g@x.co" }, { "x-forwarded-for": "198.51.100.2" }), deps())).status).toBe(200);
    expect(stored).toHaveLength(11);
  });
  it("still answers ok when the db fails and the file catches it (visitor never sees a sink error)", async () => {
    const file: WaitlistEntry[] = [];
    sinks = {
      db: async () => {
        throw new Error("db down");
      },
      email: null,
      file: async (e) => {
        file.push(e);
      },
    };
    const res = await handleWaitlist(post({ email: "a@b.co" }), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(file).toHaveLength(1);
  });
  it("answers ok even when every sink fails (logged, not surfaced)", async () => {
    const logs: string[] = [];
    sinks = {
      db: null,
      email: null,
      file: async () => {
        throw new Error("disk full");
      },
    };
    const res = await handleWaitlist(post({ email: "a@b.co" }), { ...deps(), log: (m) => logs.push(m) });
    expect(await res.json()).toEqual({ ok: true });
    expect(logs.some((l) => /every sink failed/.test(l))).toBe(true);
  });
  it("clientIp: first x-forwarded-for hop, else x-real-ip, else unknown", () => {
    expect(clientIp(post({}, { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(post({}, { "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(post({}))).toBe("unknown");
  });
});

/* The real sinks, env-gated. */
let serviceRole = false;
const inserts: Record<string, unknown>[] = [];
let insertError: { code?: string } | null = null;
vi.mock("@/lib/db/server", () => ({
  isServiceRoleConfigured: () => serviceRole,
  getServiceSupabase: () => ({ from: (t: string) => ({ insert: async (row: Record<string, unknown>) => (inserts.push({ table: t, ...row }), { error: insertError }) }) }),
  getServerSupabase: async () => null,
}));

describe("default sinks (env-gated)", async () => {
  const { dbSink, defaultSinks, emailSink, fileSink, RESEND_URL, WAITLIST_FROM, WAITLIST_TO } = await import("../sinks");
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "unc-waitlist-"));
    inserts.length = 0;
    insertError = null;
    serviceRole = false;
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("db sink is null without the service role; inserts the row when present; 23505 → duplicate", async () => {
    expect(dbSink()).toBeNull();
    serviceRole = true;
    const sink = dbSink()!;
    await expect(sink(entry())).resolves.toBeUndefined();
    expect(inserts).toEqual([{ table: "waitlist", email: "founder@example.test", country: "NZ", source: "hero", referrer: null, created_at: "2026-09-02T09:00:00.000Z" }]);
    insertError = { code: "23505" };
    await expect(sink(entry())).resolves.toBe("duplicate");
    insertError = { code: "42P01" };
    await expect(sink(entry())).rejects.toThrow(/42P01/);
  });
  it("email sink is null without RESEND_API_KEY; posts to Resend from/to tom@getjunction.ai; non-2xx throws", async () => {
    const blockedFetch = vi.fn();
    expect(emailSink(blockedFetch, { RESEND_API_KEY: "re_fake", UNC_MESSAGING_ENABLED: "false" })).toBeNull();
    expect(blockedFetch).not.toHaveBeenCalled();
    expect(emailSink(fetch, {})).toBeNull();
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const sink = emailSink(fakeFetch, { RESEND_API_KEY: "re_fake" })!;
    await sink(entry());
    expect(calls[0].url).toBe(RESEND_URL);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_fake");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.from).toBe(WAITLIST_FROM);
    expect(body.to).toEqual([WAITLIST_TO]);
    expect(WAITLIST_FROM).toContain("tom@getjunction.ai");
    expect(WAITLIST_TO).toBe("tom@getjunction.ai");
    expect(body.subject).toBe("Waitlist: founder@example.test");
    expect(body.text).toContain("founder@example.test");
    const failing = emailSink((async () => new Response("nope", { status: 422 })) as typeof fetch, { RESEND_API_KEY: "re_fake" })!;
    await expect(failing(entry())).rejects.toThrow(/resend 422/);
  });
  it("file sink appends one JSON line per signup, creating the directory", async () => {
    const sink = fileSink(path.join(dir, "nested", ".data"));
    await sink(entry());
    await sink(entry({ email: "second@x.co" }));
    const lines = (await readFile(path.join(dir, "nested", ".data", "waitlist.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ email: "founder@example.test", country: "NZ" });
    expect(JSON.parse(lines[1])).toMatchObject({ email: "second@x.co" });
  });
  it("defaultSinks reflects the env: nothing configured → only the file sink", () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const s = defaultSinks();
    expect(s.db).toBeNull();
    expect(s.email).toBeNull();
    expect(typeof s.file).toBe("function");
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  });
});
