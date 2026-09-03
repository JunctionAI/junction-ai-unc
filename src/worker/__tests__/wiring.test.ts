/* Environment → adapters: which CredentialProvider / AccountsSource the worker and the API
   routes get, and what DbAccountsSource reads from the schema-checked fake. */

import { afterEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { keyringFromKeys } from "@/lib/connectors/crypto";
import { ConnectorCredentialProvider } from "@/lib/connectors/tokens";
import { DbAccountsSource, DEFAULT_APPROVER, StaticAccountsSource } from "../accounts";
import { FixtureCredentialProvider, NoCredentialsProvider } from "../credentials";
import { accountsKind, credentialsKind, defaultAccountsSource, defaultCredentialProvider, describeWiring, envKeyring, selectAccountsSource, selectCredentialProvider } from "../wiring";

const KEYRING = keyringFromKeys({ version: 1, key: Buffer.alloc(32, 7) });
const ACCT = "00000000-0000-4000-8000-00000000acc1";
const IDLE = "00000000-0000-4000-8000-00000000acc2";

const SUPA = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CONNECTOR_SECRET_KEY"] as const;
const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const k of SUPA) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function withEnv(env: Partial<Record<(typeof SUPA)[number], string>>) {
  for (const k of SUPA) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
}

describe("credential provider selection", () => {
  it("fixtures only without a DB; a real DB without a secret store means nothing is connected — never fixtures", () => {
    const db = new FakeSupabase();
    expect(selectCredentialProvider({ db: null, keyring: null, env: {} })).toBeInstanceOf(FixtureCredentialProvider);
    expect(selectCredentialProvider({ db, keyring: null, env: {} })).toBeInstanceOf(NoCredentialsProvider);
    expect(selectCredentialProvider({ db: null, keyring: KEYRING, env: {} })).toBeInstanceOf(FixtureCredentialProvider);
    expect(selectCredentialProvider({ db, keyring: KEYRING, env: {} })).toBeInstanceOf(ConnectorCredentialProvider);
    expect(credentialsKind({ db, keyring: KEYRING })).toBe("connectors");
    expect(credentialsKind({ db, keyring: null })).toBe("none");
    expect(credentialsKind({ db: null, keyring: null })).toBe("fixture");
  });
  it("the connectors provider answers null (nothing connected) for an account with no connector row — the honest 'couldn't ask' path", async () => {
    const db = new FakeSupabase();
    const p = selectCredentialProvider({ db, keyring: KEYRING, env: {} });
    expect(await p.get(ACCT, "shopify")).toBeNull();
    expect(await new FixtureCredentialProvider().get(ACCT, "shopify")).toEqual({ kind: "fixture", platform: "shopify", marker: "fixture:shopify" });
  });
  it("from the real environment: nothing set → fixture + static; the worker stays importable", () => {
    withEnv({});
    expect(defaultCredentialProvider()).toBeInstanceOf(FixtureCredentialProvider);
    expect(defaultAccountsSource()).toBeInstanceOf(StaticAccountsSource);
    expect(describeWiring()).toEqual({ credentials: "fixture", accounts: "static" });
    expect(envKeyring({})).toBeNull();
    expect(envKeyring({ CONNECTOR_SECRET_KEY: "not-32-bytes" })).toBeNull(); // malformed reads as unconfigured here
    expect(envKeyring({ CONNECTOR_SECRET_KEY: Buffer.alloc(32, 1).toString("base64") })).not.toBeNull();
  });
  it("from the real environment: DB + key set → connectors + db", () => {
    withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", CONNECTOR_SECRET_KEY: Buffer.alloc(32, 1).toString("base64") });
    expect(describeWiring()).toEqual({ credentials: "connectors", accounts: "db" });
    expect(defaultCredentialProvider()).toBeInstanceOf(ConnectorCredentialProvider);
    expect(defaultAccountsSource()).toBeInstanceOf(DbAccountsSource);
  });
  it("from the real environment: URL + service role is enough — the anon key is a browser concern", () => {
    withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", CONNECTOR_SECRET_KEY: Buffer.alloc(32, 1).toString("base64") });
    expect(describeWiring()).toEqual({ credentials: "connectors", accounts: "db" });
    expect(defaultAccountsSource()).toBeInstanceOf(DbAccountsSource);
  });
});

describe("accounts source", () => {
  it("static without a DB, db-backed with one", () => {
    expect(selectAccountsSource(null)).toBeInstanceOf(StaticAccountsSource);
    expect(selectAccountsSource(new FakeSupabase())).toBeInstanceOf(DbAccountsSource);
    expect(accountsKind(null)).toBe("static");
    expect(accountsKind(new FakeSupabase())).toBe("db");
  });
  it("DbAccountsSource lists accounts with ≥1 enabled routine and resolves currency / budget / approver / website", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [
      { id: ACCT, name: "Example Co", currency: "AUD" },
      { id: IDLE, name: "Idle Co", currency: "NZD" },
    ]);
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 4200, website: "example.com" }]);
    db.seed("team_members", [
      { account_id: ACCT, position: 0, name: "Tom", role: "Founder", approves: "" },
      { account_id: ACCT, position: 1, name: "Sam", role: "Marketing", approves: "Content, Email & SMS" },
    ]);
    db.seed("routine_states", [
      { account_id: ACCT, routine_id: "D01-W01", enabled: true },
      { account_id: ACCT, routine_id: "D05-W02", enabled: true },
      { account_id: IDLE, routine_id: "D01-W01", enabled: false },
    ]);
    const src = new DbAccountsSource(db);
    const listed = await src.listAccounts();
    expect(listed.map((a) => a.account.accountId)).toEqual([ACCT]);
    expect(listed[0]).toEqual({ account: { accountId: ACCT, currency: "AUD", budgetMonthly: 4200, approver: "Sam" }, vars: { website: "example.com" } });
    // getAccount resolves any account, enabled routines or not; defaults when the profile is missing
    expect(await src.getAccount(IDLE)).toEqual({ account: { accountId: IDLE, currency: "NZD", budgetMonthly: 0, approver: DEFAULT_APPROVER }, vars: {} });
    expect(await src.getAccount("00000000-0000-4000-8000-00000000nope")).toBeNull();
  });
});
