/* Independent, GET-only execution reader. No workflow listing, retry, activation or mutation.
 * Pilot configuration is server-owned and off until real API acceptance is completed. */
import { setTimeout as sleep } from "node:timers/promises";
import { projectShadowExecution } from "../../lib/n8n/executionEvidence";
import { checkWebhookTarget, type HostLookup } from "../../lib/n8n/urlSecurity";
import { pinnedWebhookFetch, type WebhookFetch } from "./pinnedWebhookFetch";

export const N8N_EXECUTION_API_BASE = "https://junctionai8.app.n8n.cloud/api/v1";
export interface ShadowExecutionReadInput { workflowId: string; executionId: string; signal: AbortSignal }
export type ShadowExecutionReader = (input: ShadowExecutionReadInput) => Promise<unknown>;
export interface ExecutionReaderOptions {
  fetch?: WebhookFetch;
  lookup?: HostLookup;
  /** Test seam. Production uses abortable, bounded delays between reads of the same execution. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** A missing/invalid pin or credential returns no reader, so the bridge refuses BEFORE POST.
 * Do not reuse the webhook bearer, signing root or any DataForSEO/customer credential. */
export function createShadowExecutionReader(
  env: Record<string, string | undefined>, workflowId: string, opts: ExecutionReaderOptions = {},
): ShadowExecutionReader | undefined {
  if (env.N8N_EXECUTION_READER_ENABLED !== "true" || env.N8N_EXECUTION_API_BASE_URL !== N8N_EXECUTION_API_BASE) return undefined;
  const key = env.N8N_EXECUTION_API_KEY ?? "", triggerNodeId = env.N8N_SHADOW_TRIGGER_NODE_ID ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workflowId) || env.N8N_SHADOW_WORKFLOW_ID !== workflowId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(triggerNodeId) ||
      key.length < 24 || key.length > 8192 || /\s/.test(key) ||
      key === env.N8N_SIGNING_SECRET || key === env.N8N_SHADOW_RECEIVER_TOKEN) return undefined;
  const transport = opts.fetch ?? pinnedWebhookFetch;
  const wait = opts.wait ?? (async (ms, signal) => { await sleep(ms, undefined, { signal }); });
  return async input => {
    if (input.workflowId !== workflowId || !/^[1-9]\d{0,29}$/.test(input.executionId)) throw new Error("n8n execution reader identity refused");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(8_000)]);
    signal.throwIfAborted();
    const url = `${N8N_EXECUTION_API_BASE}/executions/${input.executionId}?includeData=true`;
    // Always enforce production DNS checks, including in a test process; tests inject DNS.
    const target = await checkWebhookTarget(url, { NODE_ENV: "production" }, { maxLength: 2000, lookup: opts.lookup });
    signal.throwIfAborted();
    if (!target.ok || !target.pin) throw new Error("n8n execution reader destination refused");
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted();
      let retry = false;
      try {
        const response = await transport(url, { method: "GET", redirect: "manual", cache: "no-store",
          headers: { accept: "application/json", "X-N8N-API-KEY": key }, signal }, target.pin);
        // Retry only safe reads; never forward errors/bodies or follow a redirect with the key.
        retry = response.status === 404 || response.status === 429 || response.status >= 500;
        if (response.status === 200) {
          const value = await response.json();
          const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
          if (!row || row.id !== input.executionId || row.workflowId !== workflowId) throw new Error("execution identity mismatch");
          retry = row.status === "new" || row.status === "running";
          if (!retry) return projectShadowExecution(value, { ...input, triggerNodeId });
        } else if (!retry) throw new Error("execution read refused");
      } catch {
        // No broad transport retry: response size/JSON/auth/identity faults stay terminal.
        throw new Error("n8n execution read failed; evidence remains unverified");
      }
      if (!retry || attempt === 3) break;
      await wait([250, 750, 1500][attempt], signal);
    }
    throw new Error("n8n execution not finalized or unavailable; reconcile without rerunning");
  };
}
