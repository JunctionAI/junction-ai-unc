/* SERVER ONLY — the real ProxyDeps for the /api/n8n/* routes, from the environment: the
   process-wide store, the same credential provider the worker gets (wiring.ts), the service
   role for the context, N8N_SIGNING_SECRET. Nothing here is imported by the worker. */

import { getStore } from "../runtime/store";
import { credentialsKind, defaultCredentialProvider, envKeyring, serviceDb } from "../../worker/wiring";
import { N8N_SECRET_ENV } from "../../worker/providers/n8n";
import type { ProxyDeps } from "./proxy";

export function proxyDeps(env: Record<string, string | undefined> = process.env): ProxyDeps {
  const db = serviceDb();
  return {
    store: getStore(),
    secret: env[N8N_SECRET_ENV],
    credentials: defaultCredentialProvider(env),
    credentialsKind: credentialsKind({ db, keyring: envKeyring(env) }),
    db,
  };
}
