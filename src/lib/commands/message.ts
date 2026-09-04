import type { DbClient } from "../db/types";
import type { Store } from "../runtime/store/interface";
import { dispatchDeps } from "./deps";
import { dispatchMessage } from "./dispatch";
import { commandsEnabled, type CommandActor, type DispatchReply } from "./types";

/** Both app and verified channels enter here. Never leak database/provider errors to chat. */
export async function routeCommand(db: DbClient, store: Store, actor: CommandActor, text: string): Promise<DispatchReply | null> {
  if (!commandsEnabled()) return null;
  try { return await dispatchMessage(dispatchDeps(db, store, actor.accountId), actor, text); }
  catch { return { reply: "I couldn’t confirm whether your request was saved. Check its status in Unc before sending a new request; I won’t claim it ran." }; }
}
