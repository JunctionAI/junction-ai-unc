/** Explicit operator entry point, not generic chat/schedule admission. A caller must
 * supply existing owner authorization; this never creates bindings or enables work. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { runRoutine, type Adapters } from "../lib/runtime/engine";
import type { RoutineSpec, AccountContext } from "../lib/runtime/types";
import { calendarReservation, calendarScope, calendarStartClaim, type CalendarApproval, type CalendarScope } from "../lib/n8n/calendarAdmission";
import { calendarShadowSchema, CALENDAR_SHADOW_RECEIVER_URL, type CalendarShadowContract } from "../lib/n8n/calendarShadowContract";
import { calendarShadowSpec } from "../lib/n8n/calendarShadowSpec";
import { createShadowExecutionReader } from "./providers/n8nExecutionReader";

export async function runCalendarShadow(input: CalendarScope & { bindingId: string; approval: CalendarApproval; data?: CalendarShadowContract["data"] }, deps: {
  db: DbClient; account: AccountContext; adapters: Adapters; env: Record<string, string | undefined>; now?: () => Date;
}) {
  const scope = calendarScope(input);
  if (deps.account.accountId !== scope.accountId || deps.account.contextGeneration !== scope.contextGeneration || input.approval.contextGeneration !== scope.contextGeneration)
    throw new Error("Calendar account context mismatch");
  await assertRuntimeContext(deps.db, scope);
  const binding = await unwrap<Row | null>("calendar.binding", deps.db.from("n8n_calendar_bindings")
    .select("id,account_id,context_generation,spec_template,revoked_at").eq("id", input.bindingId)
    .eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).maybeSingle());
  if (!binding || binding.revoked_at !== null) throw new Error("Accepted calendar binding unavailable");
  const template = binding.spec_template as RoutineSpec;
  const node = template?.nodes?.[1];
  const contract = calendarShadowSchema.parse(node?.kind === "n8n" ? node.shadowContract : null);
  if (contract.accountId !== scope.accountId || contract.client.bindingId !== input.bindingId || contract.client.currency !== deps.account.currency ||
      !isDeepStrictEqual(template, calendarShadowSpec(contract, template.version)))
    throw new Error("Reviewed calendar binding specification changed");
  const env = deps.env;
  if (env.N8N_CALENDAR_SHADOW_RECEIVER_URL !== CALENDAR_SHADOW_RECEIVER_URL || !env.N8N_CALENDAR_SHADOW_RECEIVER_TOKEN?.trim() ||
      env.N8N_CALENDAR_SHADOW_RECEIVER_TOKEN === env.N8N_SHADOW_RECEIVER_TOKEN || !env.N8N_SIGNING_SECRET?.trim() ||
      !createShadowExecutionReader(env, contract.workflowId, { protocol: "calendar" }))
    throw new Error("Calendar receiver and independent execution reader must be pinned before issuance");
  const selected = calendarShadowSchema.parse({ ...contract, data: input.data ?? contract.data });
  const spec = calendarShadowSpec(selected, template.version);
  // No caller text, vars or arbitrary read results become provider instructions.
  return runRoutine(spec, { account: structuredClone(deps.account), triggeredBy: "manual" }, deps.adapters, {
    mode: "dry_run", runId: scope.runId, reserveCalendarShadowRun: calendarReservation(deps.db, input.approval, deps.now),
    claimCalendarShadowStart: calendarStartClaim(deps.db),
  });
}
