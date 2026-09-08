import {describe,it,expect,vi} from 'vitest';
import {FakeSupabase} from '../../lib/db/__tests__/fakeSupabase';
import {runGrokControlQueueTick} from '../grokControlQueue';
const account='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const at=Date.parse('2026-09-09T00:00:00Z');
const change={changeId:id,accountId:account,contextGeneration:0,routineId:'D02-W01',workerId:'sandbox',enabled:false,
 stateUpdatedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+300000).toISOString(),schedule:{time:'08:00',timezone:'UTC'}};
function fixture(){
 const db=new FakeSupabase();
 db.seed('accounts',[{id:account,context_generation:0,automation_paused:true}]);
 db.seed('routine_states',[{account_id:account,routine_id:change.routineId,enabled:false,updated_at:change.stateUpdatedAt}]);
 db.seed('grok_routine_settings',[{account_id:account,routine_id:change.routineId,context_generation:0,worker_id:'sandbox',enabled:false,
  updated_at:change.stateUpdatedAt,schedule_time:'08:00:00',timezone:'UTC'}]);
 db.seed('grok_settings_outbox',[{id,account_id:account,context_generation:0,routine_id:change.routineId,revision:1,change}]);
 const registration={accountId:account,contextGeneration:0,workerId:'sandbox',routineIds:['D02-W01'],
  webhookUrl:'https://api2.cursor.sh/test',webhookKeyEnv:'JUNCTION_GROK_WEBHOOK_TEST',callbackOrigin:'https://junction.example'};
 const env:Record<string,string>={JUNCTION_GROK_QUEUE_ENABLED:'true',JUNCTION_GROK_SETTINGS_ENABLED:'true',JUNCTION_GROK_CONTROL_ENABLED:'true',
  JUNCTION_GROK_SETTINGS_ACCOUNT_IDS:account,JUNCTION_GROK_CONTROL_SECRET:'test-only-signing-key-012345678901234567890',
  JUNCTION_GROK_WEBHOOK_TEST:'test-only-webhook-key',JUNCTION_GROK_QUEUE_REGISTRATIONS:JSON.stringify([registration])};
 const fetcher=vi.fn(async()=>Response.json({accepted:true}));
 return {db,env,registration,fetcher,run:()=>runGrokControlQueueTick(db,{env,fetcher,now:()=>at})};
}
describe('Grok queue — simulated database/network, no native runtime',()=>{
 it('does no database or network work while disabled',async()=>{
  const f=fixture();f.env.JUNCTION_GROK_QUEUE_ENABLED='false';const read=vi.spyOn(f.db,'from');
  expect(await f.run()).toEqual({status:'disabled'});expect(read).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('delivers a stop while paused once and never resends its claim',async()=>{
  const f=fixture();expect(await f.run()).toMatchObject({status:'attempted',outcome:'accepted',accountId:account,changeId:id});
  expect(await f.run()).toMatchObject({status:'idle'});expect(f.fetcher).toHaveBeenCalledOnce();
 });
 it('retains an ambiguous attempt and does not retry it',async()=>{
  const f=fixture();f.fetcher.mockRejectedValue(new Error('timeout'));
  expect(await f.run()).toMatchObject({outcome:'needs_reconciliation'});
  expect(await f.run()).toMatchObject({status:'idle'});expect(f.fetcher).toHaveBeenCalledOnce();
 });
 it.each(['foreign-account','missing-secret','bad-url','duplicate'])('refuses %s registrations before I/O',async kind=>{
  const f=fixture();
  if(kind==='foreign-account')f.env.JUNCTION_GROK_SETTINGS_ACCOUNT_IDS='';
  if(kind==='missing-secret')delete f.env.JUNCTION_GROK_WEBHOOK_TEST;
  if(kind==='bad-url')f.registration.webhookUrl='https://untrusted.example/webhook';
  f.env.JUNCTION_GROK_QUEUE_REGISTRATIONS=JSON.stringify(kind==='duplicate'?[f.registration,f.registration]:[f.registration]);
  const read=vi.spyOn(f.db,'from');expect(await f.run()).toEqual({status:'misconfigured'});
  expect(read).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('does not wake the runtime for expired or superseded settings',async()=>{
  const f=fixture();await f.db.from('grok_routine_settings').update({updated_at:new Date(at).toISOString()}).eq('account_id',account);
  expect(await f.run()).toMatchObject({status:'idle'});expect(f.fetcher).not.toHaveBeenCalled();
  await f.db.from('grok_settings_outbox').update({change:{...change,expiresAt:new Date(at).toISOString()}}).eq('id',id);
  expect(await f.run()).toMatchObject({status:'idle'});expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('refuses a mismatched native worker',async()=>{
  const f=fixture();f.env.JUNCTION_GROK_QUEUE_REGISTRATIONS=JSON.stringify([{...f.registration,workerId:'other'}]);
  await expect(f.run()).rejects.toThrow('binding mismatch');expect(f.fetcher).not.toHaveBeenCalled();
 });
});
