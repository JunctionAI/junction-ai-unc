import type { CommandActor } from "./types";
import { runtimeGeneration } from "../runtime/contextFence";

export function freezeCommandActor(actor: CommandActor): CommandActor {
  return Object.freeze({ ...actor, ...(actor.channelBinding ? { channelBinding: Object.freeze({ ...actor.channelBinding }) } : {}) });
}

export function commandChannelBinding(actor: CommandActor, generation = runtimeGeneration(actor.contextGeneration)) {
  if (actor.channel === "app") {
    if (actor.linkId || actor.channelBinding) throw new Error("App command cannot carry a channel binding");
    return null;
  }
  const b = actor.channelBinding;
  if (b && (b.conversationId !== undefined || b.threadId !== undefined) &&
    (actor.channel !== "slack" || !/^[CDG][A-Z0-9]{1,63}$/.test(b.conversationId ?? "") || !/^\d{1,12}(?:\.\d{1,6})?$/.test(b.threadId ?? "")))
    throw new Error("Original Slack command conversation/thread required");
  if (!actor.linkId || !b || !Number.isSafeInteger(b.bindingVersion) || b.bindingVersion < 0 ||
    !b.externalId || actor.channel === "slack" && !b.scopeId) throw new Error("Original command channel binding required");
  return { version: 1, kind: "linked", accountId: actor.accountId, contextGeneration: generation,
    userId: actor.userId, linkId: actor.linkId, bindingVersion: b.bindingVersion, channel: actor.channel,
    externalId: b.externalId, ...(actor.channel === "slack" ? { scopeId: b.scopeId } : {}),
    ...(b.conversationId ? { conversationId: b.conversationId, threadId: b.threadId } : {}) };
}
