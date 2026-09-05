import type { FakeSupabase } from "./fakeSupabase";
import type { Row } from "../types";
import type { RunRecord } from "../../runtime/store/interface";

/** Transport fixture only. Actual locking and rollback are tested on PostgreSQL. */
export function installManualRoutineFake(db:FakeSupabase) {
  const fail=(code="40001"):never=>{throw Object.assign(new Error(code),{code});};
  const owned=(p:Row)=>{
    const a=db.rows("accounts").find(a=>a.id===p.p_account);
    const m=db.rows("account_members").find(m=>m.account_id===p.p_account && m.user_id===p.p_actor);
    return a && a.context_generation===p.p_generation && m?.role==="owner" ? a : null;
  };
  const find=(p:Row)=>db.rows("manual_routine_requests").find(o=>o.account_id===p.p_account && o.context_generation===p.p_generation && o.actor_id===p.p_actor && o.request_id===p.p_request);
  const read=(p:Row)=>{
    const o=find(p), r=db.rows("routine_runs").find(r=>r.id===o?.run_id);
    return owned(p) && o && r?structuredClone({operation:o,run:r}):null;
  };
  const domain=(id:string)=>({D01:"content",D02:"paid",D03:"seo",D04:"sales",D05:"email"}[id.slice(0,3)]);
  const current=async(p:Row,routine:string)=>(await db.rpcs.read_routine_editor({...p,p_routine:routine,p_domain:domain(routine)})) as Row;
  db.rpcs.read_manual_routine_request=read;
  db.rpcs.prepare_manual_routine_request=async p=>{
    const a=owned(p);if(!a)return fail("42501");
    const o=find(p);
    if(o){if(o.purpose!==p.p_purpose || JSON.stringify(o.request_body)!==JSON.stringify(p.p_body))return fail();return read(p);}
    const r=p.p_initial as unknown as RunRecord;
    const snapshot=await current(p,r.routineId);
    if(a.automation_paused || r.routineId==="D03-W01" || !(snapshot?.state as Row)?.enabled || snapshot.configurationRevision!==p.p_revision)return fail();
    if(r.accountId!==p.p_account || r.contextGeneration!==p.p_generation || r.mode!=="dry_run")return fail("22023");
    if(p.p_purpose==="input") {
      const saved=db.rows("routine_runs").find(s=>s.id===r.id);
      if(!saved || saved.status!=="waiting_input" || (saved.input_revision??0)!==(r.inputRevision??0) || JSON.stringify(saved.snapshot)!==JSON.stringify(r.snapshot))return fail();
    } else {
      if(db.rows("routine_runs").some(s=>s.account_id===p.p_account && s.context_generation===p.p_generation && s.routine_id===r.routineId && ["running","waiting_input","waiting_approval"].includes(String(s.status))))return fail();
      db.upsertRow("routine_runs",{id:r.id,account_id:r.accountId,context_generation:r.contextGeneration,routine_id:r.routineId,version:r.version,mode:r.mode,status:r.status,started_at:r.startedAt,spec_hash:r.specHash,snapshot:r.snapshot,summary:"Prepared; not started."},"id");
    }
    db.upsertRow("manual_routine_requests",{account_id:p.p_account,context_generation:p.p_generation,actor_id:p.p_actor,request_id:p.p_request,
      routine_id:r.routineId,purpose:p.p_purpose,request_body:p.p_body,configuration_revision:p.p_revision,initial_record:r,run_id:r.id,phase:"prepared",created_at:db.now(),claimed_at:null},"account_id,context_generation,actor_id,request_id");
    return read(p);
  };
  db.rpcs.claim_manual_routine_request=async p=>{
    const a=owned(p),o=find(p);if(!a)return fail("42501");if(a.automation_paused || !o)return fail();
    if(o.phase==="claimed")return false;
    const snapshot=await current(p,String(o.routine_id));
    if(!(snapshot.state as Row)?.enabled || snapshot.configurationRevision!==o.configuration_revision)return fail();
    const r=db.rows("routine_runs").find(r=>r.id===o.run_id);
    if(!r || r.status!==(o.purpose==="input"?"waiting_input":"running") || o.purpose==="input" && (r.input_revision??0)!==((o.initial_record as RunRecord).inputRevision??0) || JSON.stringify(r.snapshot)!==JSON.stringify((o.initial_record as RunRecord).snapshot))return fail();
    // No await between this final check and writes: one fake claim winner too.
    if(find(p)?.phase==="claimed")return false;
    db.upsertRow("manual_routine_requests",{...o,phase:"claimed",claimed_at:db.now()},"account_id,context_generation,actor_id,request_id");
    db.upsertRow("routine_runs",{...r,status:"running",finished_at:null,input_revision:Number(r.input_revision??0)+(o.purpose==="input"?1:0),summary:"Start claimed; inspect saved outcome before retrying."},"id");
    return true;
  };
}
