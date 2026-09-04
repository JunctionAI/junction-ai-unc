import type { Env } from "./types";

/** Server-side release switch. Does not affect authenticated in-app chat or login emails. */
export const messagingDisabled = (env: Env): boolean => env.UNC_MESSAGING_ENABLED === "false";
export const MESSAGING_DISABLED_NOTE = "External messaging is disabled for this release. Use in-app chat.";
