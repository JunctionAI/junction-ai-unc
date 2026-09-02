/* Environment → adapters. The ONLY place the worker decides between demo and live plumbing:

     credentials  DB (service role) + secret store (CONNECTOR_SECRET_KEY) configured
                    → ConnectorCredentialProvider  (real tokens from connector_secrets)
                  otherwise → FixtureCredentialProvider (fixture markers, canned reads)
     accounts     DB configured → DbAccountsSource, otherwise StaticAccountsSource (`demo`)

   select*() are pure (everything injected) so the choice is unit-tested; default*() read
   process.env and build the real clients. Importable without any env set: nothing here
   touches the environment at module load. */

import { asDb } from "../lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../lib/db/server";
import type { DbClient } from "../lib/db/types";
import { keyringFromEnv, type Keyring } from "../lib/connectors/crypto";
import { ConnectorCredentialProvider } from "../lib/connectors/tokens";
import { DbAccountsSource, StaticAccountsSource, type AccountsSource } from "./accounts";
import { FixtureCredentialProvider, NoCredentialsProvider, type CredentialProvider } from "./credentials";

export type CredentialsKind = "fixture" | "none" | "connectors";
export type AccountsKind = "static" | "db";

export interface WiringInputs {
  /** Service-role client; null when the DB isn't configured. */
  db: DbClient | null;
  /** null when CONNECTOR_SECRET_KEY is absent or malformed. */
  keyring: Keyring | null;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (line: string) => void;
}

export function credentialsKind(inputs: Pick<WiringInputs, "db" | "keyring">): CredentialsKind {
  if (inputs.db && inputs.keyring) return "connectors";
  // A real database means real accounts: without a secret store nothing is connected — never fixtures.
  if (inputs.db) return "none";
  return "fixture";
}

export function selectCredentialProvider(inputs: WiringInputs): CredentialProvider {
  const kind = credentialsKind(inputs);
  if (kind === "fixture" || !inputs.db) return new FixtureCredentialProvider();
  if (kind === "none" || !inputs.keyring) return new NoCredentialsProvider();
  return new ConnectorCredentialProvider({
    db: inputs.db,
    keyring: inputs.keyring,
    env: inputs.env,
    fetch: inputs.fetch ?? ((input, init) => fetch(input, init)),
    now: inputs.now ?? (() => new Date()),
    log: inputs.log,
  });
}

export function accountsKind(db: DbClient | null): AccountsKind {
  return db ? "db" : "static";
}

export function selectAccountsSource(db: DbClient | null): AccountsSource {
  return db ? new DbAccountsSource(db) : new StaticAccountsSource();
}

// ---------- from the real environment ----------

/** Service-role client when the DB is configured, else null. Never throws. */
export function serviceDb(): DbClient | null {
  if (!isServiceRoleConfigured()) return null;
  try {
    return asDb(getServiceSupabase());
  } catch {
    return null;
  }
}

/** Keyring from the environment; a malformed key reads as "not configured" here (the
    connect routes are where that is reported loudly). */
export function envKeyring(env: Record<string, string | undefined> = process.env): Keyring | null {
  try {
    return keyringFromEnv(env);
  } catch {
    return null;
  }
}

export function defaultCredentialProvider(env: Record<string, string | undefined> = process.env, log?: (line: string) => void): CredentialProvider {
  return selectCredentialProvider({ db: serviceDb(), keyring: envKeyring(env), env, log });
}

export function defaultAccountsSource(): AccountsSource {
  return selectAccountsSource(serviceDb());
}

/** For logs / health: what the process is wired to, never what it holds. */
export function describeWiring(env: Record<string, string | undefined> = process.env): { credentials: CredentialsKind; accounts: AccountsKind } {
  const db = serviceDb();
  return { credentials: credentialsKind({ db, keyring: envKeyring(env) }), accounts: accountsKind(db) };
}
