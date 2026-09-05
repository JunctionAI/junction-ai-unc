import { KEYWORD_PILOT_PIN } from "../../lib/n8n/keywordAdmission";
import { createShadowExecutionReader } from "./n8nExecutionReader";

/** Configuration check only; live API access is proven separately, not by key presence. */
export function assertKeywordRuntimeAccess(env: Record<string, string | undefined> = process.env): void {
  const receiver = env.N8N_SHADOW_RECEIVER_TOKEN ?? "", signing = env.N8N_SIGNING_SECRET ?? "";
  if (env.N8N_SHADOW_RECEIVER_URL !== KEYWORD_PILOT_PIN.receiverUrl || env.N8N_DATA_BASE_URL !== "https://junction-unc.vercel.app" ||
      !signing.trim() || receiver.trim() !== receiver || receiver.length < 24 || /\s/.test(receiver) || receiver === signing ||
      !createShadowExecutionReader(env, KEYWORD_PILOT_PIN.workflowId)) throw new Error("Pilot server access configuration is not ready");
}
