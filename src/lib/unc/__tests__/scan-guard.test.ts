/* The SSRF guard in src/lib/unc/scan.ts, tested as pure functions — no network.

   Two layers:
     1. checkUrlSyntax(raw)  — pure. http(s) only, no credentials, no IP literals of any shape,
                               no localhost/.local/.internal/.home.arpa/dotless hosts.
     2. isSafeUrl(raw)       — syntax + DNS: every resolved address must be public. DNS is
                               `lookup` from node:dns/promises, which is module-mocked here so the
                               post-DNS branch (isPrivateAddress) is exercised without resolving anything.

   Note: because layer 1 rejects EVERY IP literal (public ones included), the private-range
   tests for literal IPs all fail with "I scan domain names, not IP addresses." The range logic
   itself (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, ::1, fe80::/10, …) is what
   protects the DNS step, so it is tested directly through isPrivateAddress. */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { checkUrlSyntax, isPrivateAddress, isSafeUrl, normalizeWebsite } from "../scan";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
/* scan.ts always calls lookup(host, { all: true }) — type the mock to that overload. */
const mockLookup = lookup as unknown as Mock<(host: string, opts: { all: true }) => Promise<LookupAddress[]>>;

const REASON = {
  unparseable: "That doesn't look like a web address I can read.",
  scheme: "I can only scan http(s) addresses.",
  creds: "I can't scan addresses that carry credentials.",
  ip: "I scan domain names, not IP addresses.",
  notPublic: "I can only scan public websites.",
  notFound: "I couldn't find that site — check the address.",
};

const reject = (raw: string) => {
  const r = checkUrlSyntax(raw);
  return r.ok ? `ACCEPTED ${r.url}` : r.reason;
};

describe("checkUrlSyntax — rejects", () => {
  const cases: [string, string][] = [
    ["http://127.0.0.1", REASON.ip],
    ["http://10.0.0.1/x", REASON.ip],
    ["https://172.16.0.1", REASON.ip],
    ["https://172.31.255.255", REASON.ip],
    ["https://192.168.1.1", REASON.ip],
    ["http://169.254.169.254/latest/meta-data", REASON.ip],
    ["https://100.64.0.1", REASON.ip],
    ["https://0.0.0.0", REASON.ip],
    ["https://8.8.8.8", REASON.ip], // public IPs are refused too — domain names only
    ["[::1]", REASON.ip],
    ["https://[::1]", REASON.ip],
    ["http://[::1]:8080", REASON.ip],
    ["https://[fe80::1]", REASON.ip],
    ["https://[::ffff:127.0.0.1]", REASON.ip],
    ["https://127.1", REASON.ip], // WHATWG URL normalises shorthand …
    ["https://0x7f000001", REASON.ip], // … hex …
    ["https://2130706433", REASON.ip], // … and decimal forms to 127.0.0.1 before the check
    ["::1", REASON.unparseable], // bare v6 without brackets is not a URL at all
    ["fe80::1", REASON.unparseable],
    ["ftp://avgarsport.com", REASON.scheme],
    ["file:///etc/passwd", REASON.scheme],
    ["https://user:pass@avgarsport.com", REASON.creds],
    ["https://user@avgarsport.com", REASON.creds],
    ["localhost", REASON.notPublic],
    ["http://localhost:3000", REASON.notPublic],
    ["https://foo.localhost", REASON.notPublic],
    ["foo.local", REASON.notPublic],
    ["https://api.internal", REASON.notPublic],
    ["https://box.home.arpa", REASON.notPublic],
    ["intranet", REASON.notPublic], // dotless host
    ["", REASON.unparseable],
    ["   ", REASON.unparseable],
    ["javascript:alert(1)", REASON.unparseable],
    ["https://exa mple.com", REASON.unparseable],
  ];
  for (const [raw, reason] of cases) {
    it(`${JSON.stringify(raw)} → "${reason}"`, () => {
      expect(reject(raw)).toBe(reason);
    });
  }
});

describe("checkUrlSyntax — accepts", () => {
  const cases: [string, string][] = [
    ["https://www.avgarsport.com", "https://www.avgarsport.com/"],
    ["avgarsport.com", "https://avgarsport.com/"], // scheme added
    ["HTTPS://AVGARSPORT.COM", "https://avgarsport.com/"],
    ["https://avgarsport.com:8443/shop?x=1", "https://avgarsport.com:8443/shop?x=1"],
    ["http://deepbluehealth.co.nz/about", "http://deepbluehealth.co.nz/about"],
    ["https://xn--80ak6aa92e.com", "https://xn--80ak6aa92e.com/"],
    ["https://avgarsport.com.", "https://avgarsport.com./"], // trailing-dot FQDN
  ];
  for (const [raw, url] of cases) {
    it(`${JSON.stringify(raw)} → ${url}`, () => {
      const r = checkUrlSyntax(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.url.toString()).toBe(url);
    });
  }
});

describe("normalizeWebsite", () => {
  it("adds https:// only when no scheme is present, and trims", () => {
    expect(normalizeWebsite(" avgarsport.com ")).toBe("https://avgarsport.com");
    expect(normalizeWebsite("HTTP://x.com")).toBe("HTTP://x.com");
    expect(normalizeWebsite("ftp://x.com")).toBe("ftp://x.com");
    expect(normalizeWebsite("")).toBe("");
  });
});

describe("isPrivateAddress — the post-DNS range check", () => {
  const priv = [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.0.1", // CGNAT 100.64.0.0/10
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1", // link-local fe80::/10
    "fe80::a00:27ff:fe4e:66a1",
    "feb0::1",
    "fc00::1", // ULA fc00::/7
    "fd12:3456::1",
    "::ffff:127.0.0.1", // v4-mapped loopback
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
  ];
  for (const ip of priv) it(`${ip} is private`, () => expect(isPrivateAddress(ip)).toBe(true));

  const pub = ["8.8.8.8", "1.1.1.1", "13.238.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.167.1.1", "2606:4700::1111", "2404:6800:4006::1", "::ffff:8.8.8.8"];
  for (const ip of pub) it(`${ip} is public`, () => expect(isPrivateAddress(ip)).toBe(false));

  it("anything that is not an IP is treated as unsafe", () => {
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("localhost")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });

  /* LOW-SEVERITY GAP scan.ts:95 — the v4-mapped check only recognises the dotted form
     "::ffff:a.b.c.d". The equivalent hex form "::ffff:7f00:1" (= 127.0.0.1) passes as public.
     Node's dns.lookup formats mapped addresses in dotted form, so this is not reachable through
     isSafeUrl today; it is a gap in the pure function, not a live hole. */
  it("KNOWN GAP: hex-form v4-mapped loopback ::ffff:7f00:1 should be private", () => {
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
  });
});

describe("isSafeUrl — DNS step (resolver mocked, nothing resolved)", () => {
  // Braces matter: a hook that RETURNS the mock (a function) makes vitest call it as a cleanup.
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it("a syntax rejection short-circuits before DNS is consulted", async () => {
    const r = await isSafeUrl("http://169.254.169.254/");
    expect(r).toEqual({ ok: false, reason: REASON.ip });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("a public resolution passes and returns the normalised URL", async () => {
    mockLookup.mockResolvedValue([{ address: "13.238.1.1", family: 4 }]);
    const r = await isSafeUrl("https://www.avgarsport.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.toString()).toBe("https://www.avgarsport.com/");
    expect(mockLookup).toHaveBeenCalledWith("www.avgarsport.com", { all: true });
  });

  it("a name that resolves to a private address is refused (DNS-rebinding / internal-name defence)", async () => {
    mockLookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    expect(await isSafeUrl("https://evil.example.com")).toEqual({ ok: false, reason: REASON.notPublic });
  });

  it("a name that resolves to the metadata IP is refused", async () => {
    mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await isSafeUrl("https://metadata.example.com")).toEqual({ ok: false, reason: REASON.notPublic });
  });

  it("dual-stack with ONE private address (e.g. AAAA ::1 beside a public A) is refused — all addresses must be public", async () => {
    mockLookup.mockResolvedValue([
      { address: "13.238.1.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
    expect(await isSafeUrl("https://mixed.example.com")).toEqual({ ok: false, reason: REASON.notPublic });
  });

  it("an empty resolution is refused", async () => {
    mockLookup.mockResolvedValue([]);
    expect(await isSafeUrl("https://ghost.example.com")).toEqual({ ok: false, reason: REASON.notPublic });
  });

  it("a resolver error becomes the 'couldn't find that site' reason", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isSafeUrl("https://nope.example.com")).toEqual({ ok: false, reason: REASON.notFound });
  });
});
