/** Explicit operator entry point for one paid-ads shadow run, not generic chat/schedule
 * admission. The caller supplies existing owner authorization; this never creates a
 * registration, enables a routine or touches Meta / Google Ads. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { runRoutine, type Adapters } from "../lib/runtime/engine";
import type { AccountContext, RoutineSpec } from "../lib/runtime/types";
import { paidReservation, paidScope, paidStartClaim, type PaidApproval, type PaidScope } from "../lib/n8n/paidAdmission";
import { GADS_SHADOW_RECEIVER_URL, META_SHADOW_RECEIVER_URL, paidShadowEnvPrefix, paidShadowSchema } from "../lib/n8n/paidShadowContract";
import { paidShadowSpec } from "../lib/n8n/paidShadowSpec";
import { createShadowExecutionReader } from "./providers/n8nExecutionReader";

/** Configuration check only; live API access is proven separately, not by key presence. */
export function assertPaidRuntimeAccess(env: Record<string, string | undefined>, lane: "meta" | "google_ads", workflowId: string): void {
  const prefix = lane === "meta" ? "N8N_META_SHADOW" : "N8N_GADS_SHADOW";
  const receiver = env[`${prefix}_RECEIVER_TOKEN`] ?? "", signing = env.N8N_SIGNING_SECRET ?? "";
  const expectedUrl = lane === "meta" ? META_SHADOW_RECEIVER_URL : GADS_SHADOW_RECEIVER_URL;
  if (env[`${prefix}_RECEIVER_URL`] !== expectedUrl || !signing.trim() || receiver.trim() !== receiver || receiver.length < 24 ||
      /\s/.test(receiver) || receiver === signing || receiver === env.N8N_SHADOW_RECEIVER_TOKEN || receiver === env.N8N_CALENDAR_SHADOW_RECEIVER_TOKEN ||
      !createShadowExecutionReader(env, workflowId, { protocol: lane })) throw new Error("Paid-ads server access configuration is not ready");
}

export async function runPaidShadow(input: PaidScope & { bindingId: string; approval: PaidApproval }, deps: {
  db: DbClient; account: AccountContext; adapters: Adapters; env: Record<string, string | undefined>; now?: () => Date;
}) {
  const scope = paidScope(input);
  if (deps.account.accountId !== scope.accountId || deps.account.contextGeneration !== scope.contextGeneration || input.approval.contextGeneration !== scope.contextGeneration)
    throw new Error("Paid-ads account context mismatch");
  await assertRuntimeContext(deps.db, scope);
  const binding = await unwrap<Row | null>("paid.binding", deps.db.from("n8n_paid_bindings")
    .select("id,account_id,context_generation,spec_template,revoked_at").eq("id", input.bindingId)
    .eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).maybeSingle());
  if (!binding || binding.revoked_at !== null) throw new Error("Accepted paid-ads binding unavailable");
  const template = binding.spec_template as RoutineSpec;
  const node = template?.nodes?.[1];
  const contract = paidShadowSchema.parse(node?.kind === "n8n" ? node.shadowContract : null);
  if (contract.accountId !== scope.accountId || contract.lane !== input.approval.lane ||
      !isDeepStrictEqual(template, paidShadowSpec(contract, template.version)))
    throw new Error("Reviewed paid-ads binding specification changed");
  assertPaidRuntimeAccess(deps.env, contract.lane, contract.workflowId);
  if ((deps.env[`${paidShadowEnvPrefix(contract)}_RECEIVER_TOKEN`] ?? "") === (deps.env.N8N_SHADOW_RECEIVER_TOKEN ?? ""))
    throw new Error("Paid-ads receiver credential must not be the keyword credential");
  const spec = paidShadowSpec(contract, template.version);
  // No caller text, vars or arbitrary read results become provider instructions.
  return runRoutine(spec, { account: structuredClone(deps.account), triggeredBy: "manual" }, deps.adapters, {
    mode: "dry_run", runId: scope.runId, reservePaidShadowRun: paidReservation(deps.db, input.approval, deps.now),
    claimPaidShadowStart: paidStartClaim(deps.db),
  });
}
