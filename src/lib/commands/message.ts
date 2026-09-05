import type { DbClient } from "../db/types";
import type { Store } from "../runtime/store/interface";
import { dispatchDeps } from "./deps";
import { dispatchMessage } from "./dispatch";
import { commandsEnabled, type CommandActor, type DispatchReply } from "./types";
import { RuntimeContextError } from "../runtime/contextFence";

/** Both app and verified channels enter here. Never leak database/provider errors to chat. */
export async function routeCommand(db: DbClient, store: Store, actor: CommandActor, text: string): Promise<DispatchReply | null> {
  if (!commandsEnabled()) return null;
  try { return await dispatchMessage(dispatchDeps(db, store, actor.accountId), actor, text); }
  catch (error) {
    // Ordinary account chat remains available during a setup pause. Explicit slash
    // commands get the pause reason; neither path invokes the intent model first.
    if (error instanceof RuntimeContextError) {
      if (error.code === "automation_paused" && !/^\s*\/run\b/i.test(text)) return null;
      return { reply: error.message };
    }
    return { reply: "I couldn’t confirm whether your request was saved. Check its status in Unc before sending a new request; I won’t claim it ran." };
  }
}
