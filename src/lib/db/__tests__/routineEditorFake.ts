import { createHash } from "node:crypto";
import type { FakeSupabase } from "./fakeSupabase";
import type { Row } from "../types";

/** Application/transport fixture. PostgreSQL locks/rollback are tested by the SQL canary. */
export function installRoutineEditorFake(db:FakeSupabase) {
  const fail=(code:string)=>{throw Object.assign(new Error(code),{code});};
  const snapshot=(p:Row)=>{
    const a=db.rows("accounts").find(a=>a.id===p.p_account);
    const member=db.rows("account_members").find(m=>m.account_id===p.p_account && m.user_id===p.p_actor);
    if(!a || !member || a.context_generation!==p.p_generation)return null;
    const find=(t:string)=>db.rows(t).find(r=>r.account_id===p.p_account);
    const r=find("resource_profiles");
    const data={accountId:a.id,contextGeneration:a.context_generation,role:member.role,paused:a.automation_paused,
      state:db.rows("routine_states").find(s=>s.account_id===a.id && s.routine_id===p.p_routine)??null,
      own:db.rows("routine_params").find(s=>s.account_id===a.id && s.routine_id===p.p_routine)??null,
      accountPreset:db.rows("account_presets").find(s=>s.account_id===a.id && s.domain===p.p_domain)??null,
      input:{currency:a.currency,profile:find("business_profiles")?.profile??null,
        resources:r?{budget_monthly:r.budget_monthly,gross_margin_pct:r.gross_margin_pct}:null,
        aov:db.rows("kpi_snapshots").filter(r=>r.account_id===a.id && r.context_generation===p.p_generation && r.metric_key==="aov_28d").sort((a,b)=>String(b.window_end).localeCompare(String(a.window_end)))[0]?.value??null,
        memories:db.rows("memories").filter(m=>m.account_id===a.id && m.context_generation===p.p_generation && m.kind==="fact" && !m.valid_to && (m.tags as string[]).includes("niche_band") && (m.tags as string[]).includes("niche")).map(m=>({text:m.text,tags:m.tags}))}};
    return structuredClone({...data,configurationRevision:createHash("sha256").update(JSON.stringify(data)).digest("hex")});
  };
  db.rpcs.read_routine_editor=snapshot;
  db.rpcs.commit_routine_editor=p=>{
    const a=db.rows("accounts").find(a=>a.id===p.p_account);
    const m=db.rows("account_members").find(m=>m.account_id===p.p_account && m.user_id===p.p_actor);
    if(!a || m?.role!=="owner")return fail("42501");
    if(a.context_generation!==p.p_generation || a.automation_paused)return fail("40001");
    const current=snapshot(p)!;
    if(current.configurationRevision!==p.p_expected_revision)return fail("40001");
    const state=current.state;
    if(p.p_action==="save") {
      db.upsertRow("routine_params",{account_id:a.id,routine_id:p.p_routine,domain:p.p_domain,params:p.p_params,disabled_steps:p.p_disabled_steps,source:"founder",updated_at:db.now()},"account_id,routine_id");
      db.upsertRow("routine_states",{account_id:a.id,routine_id:p.p_routine,enabled:false,version:1,live_spec:null,...state,draft_spec:p.p_draft,updated_at:db.now()},"account_id,routine_id");
    } else if(p.p_action==="discard") {
      if(state)db.upsertRow("routine_states",{...state,draft_spec:null,updated_at:db.now()},"account_id,routine_id");
    } else {
      const draft=p.p_draft as Row;
      const run=db.rows("routine_runs").filter(r=>r.account_id===a.id && (r.context_generation??0)===p.p_generation && r.routine_id===p.p_routine && r.version===Number(state?.version)+1 && r.mode==="dry_run" && r.spec_hash===p.p_spec_hash)
        .sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))||String(b.id).localeCompare(String(a.id)))[0];
      if(p.p_routine==="D03-W01" || !state?.draft_spec || JSON.stringify(state.draft_spec)!==JSON.stringify(draft) || run?.id!==p.p_validation_run || !["done","skipped"].includes(String(run?.status)) || !run?.finished_at)return fail("40001");
      db.upsertRow("routine_states",{...state,version:draft.version,live_spec:draft,draft_spec:null,updated_at:db.now()},"account_id,routine_id");
    }
    return snapshot(p);
  };
}
