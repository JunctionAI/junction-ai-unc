import { randomUUID } from "node:crypto";
import { unwrap, type DbClient } from "../db/types";

export async function claimLease(db: DbClient, key: string, seconds = 30): Promise<string | null> {
  const holder = randomUUID();
  const ok = await unwrap<boolean>("backend lease", db.rpc("claim_backend_lease", { p_key: key, p_holder: holder, p_seconds: seconds }));
  return ok ? holder : null;
}

export async function releaseLease(db: DbClient, key: string, holder: string): Promise<void> {
  await unwrap("release backend lease", db.from("backend_leases").delete().eq("lease_key", key).eq("holder", holder));
}
