import { unwrap, type DbClient } from "../db/types";
import { checkBudget } from "../llm/budget";
import type { Store } from "../runtime/store/interface";
import { connectorHasRealSync } from "../connectors/sync";
import { modelFromProfile } from "../unc/businessType";
import type { DispatchDeps } from "./dispatch";
import { modelInterpreter } from "./interpret";
import { DbCommandQueue } from "./queue";
import type { CommandActor } from "./types";

export async function commandOwner(db: DbClient, actor: CommandActor): Promise<boolean> {
  const member = await unwrap<{ role: string } | null>("commands.owner", db.from("account_members").select("role").eq("account_id", actor.accountId).eq("user_id", actor.userId).maybeSingle());
  if (member?.role !== "owner") return false;
  if (actor.channel === "app") return !actor.linkId;
  if (!actor.linkId) return false;
  const link = await unwrap<{ user_id: string; channel: string; verified_at: string | null } | null>("commands.link", db.from("channel_links").select("user_id, channel, verified_at").eq("id", actor.linkId).eq("account_id", actor.accountId).maybeSingle());
  return !!link?.verified_at && link.user_id === actor.userId && link.channel === actor.channel;
}

export function dispatchDeps(db: DbClient, store: Store, accountId: string): DispatchDeps {
  return {
    store, queue: new DbCommandQueue(db),
    isOwner: (actor) => commandOwner(db, actor),
    connected: async (id) => {
      const rows = await unwrap<{ platform: string; status: string; last_sync_result: string | null }[]>("commands.connectors", db.from("connectors").select("platform, status, last_sync_result").eq("account_id", id));
      return rows.filter((r) => connectorHasRealSync(r.status, r.last_sync_result)).map((r) => r.platform);
    },
    business: async (id) => {
      const r = await unwrap<{ profile: unknown } | null>("commands.business", db.from("business_profiles").select("profile").eq("account_id", id).maybeSingle());
      return modelFromProfile(r?.profile ?? null);
    },
    budget: async (id) => (await checkBudget(db, id, { cached: false })).ok,
    interpret: modelInterpreter(db, accountId),
  };
}
