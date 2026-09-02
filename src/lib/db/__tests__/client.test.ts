import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDbConfigured, publicSupabaseEnv } from "../client";
import { safeNext } from "../redirects";

const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});
afterEach(() => {
  if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  if (saved.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
});

describe("isDbConfigured — the env gate", () => {
  it("is off with nothing set (demo mode)", () => {
    expect(isDbConfigured()).toBe(false);
    expect(publicSupabaseEnv()).toBeNull();
  });
  it("needs BOTH public vars, non-blank", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    expect(isDbConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "   ";
    expect(isDbConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(isDbConfigured()).toBe(true);
    expect(publicSupabaseEnv()).toEqual({ url: "https://abc.supabase.co", anonKey: "anon-key" });
  });
});

describe("safeNext — post-login redirect target", () => {
  it("allows same-origin paths only", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app?tab=x")).toBe("/app?tab=x");
    expect(safeNext(null)).toBe("/app");
    expect(safeNext("")).toBe("/app");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext("/\\evil.example")).toBe("/app");
  });
});
