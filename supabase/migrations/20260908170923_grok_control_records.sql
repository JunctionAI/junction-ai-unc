-- Configuration records are not business-execution receipts. In particular,
-- pausing business automation must not prevent recording a stop request.
create table public.grok_control_records (
 id uuid primary key,
 account_id uuid not null references public.accounts(id),
 context_generation bigint not null check(context_generation>=0),
 kind text not null check(kind='notification'),
 platform text not null check(platform in ('grok_control_request','grok_control_result')),
 description text not null check(length(description) between 1 and 1000),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16000),
 created_at timestamptz not null default now()
);
alter table public.grok_control_records enable row level security;
revoke all on public.grok_control_records from public,anon,authenticated,service_role;
grant select,insert on public.grok_control_records to service_role;
create index grok_control_records_account on public.grok_control_records(account_id,context_generation,created_at desc);

create function public.guard_grok_control_record() returns trigger
language plpgsql security invoker set search_path='' as $$
declare current_generation bigint;paused boolean;change jsonb;ack jsonb;state_enabled boolean;state_updated timestamptz;request public.grok_control_records%rowtype;
begin
 select context_generation,automation_paused into current_generation,paused from public.accounts where id=new.account_id for share;
 if not found or current_generation is distinct from new.context_generation then raise exception 'Control context changed' using errcode='40001';end if;
 if new.platform='grok_control_request' then
  change:=new.payload->'change';
  if change->>'changeId' is distinct from new.id::text then raise exception 'Change identity mismatch' using errcode='23514';end if;
 else
  select * into request from public.grok_control_records where id=(new.payload->>'requestId')::uuid and account_id=new.account_id and context_generation=new.context_generation and platform='grok_control_request';
  if not found then raise exception 'Control request unavailable' using errcode='23514';end if;
  change:=request.payload->'change';ack:=new.payload->'ack';
  if ack->>'changeId' is distinct from request.id::text or ack->>'workerId' is distinct from change->>'workerId' then
   raise exception 'Acknowledgement identity mismatch' using errcode='23514';end if;
  if ack->>'status' not in ('applied','blocked','failed') or ack->>'status' is null then raise exception 'Invalid acknowledgement' using errcode='23514';end if;
  if ack->>'status'='applied' and ((ack->'enabled') is distinct from change->'enabled' or ack->'schedule' is distinct from change->'schedule' or ack->'blocker' is distinct from 'null'::jsonb) then
   raise exception 'Applied state mismatch' using errcode='23514';end if;
 end if;
 if change->>'accountId' is distinct from new.account_id::text or (change->>'contextGeneration')::bigint is distinct from new.context_generation
  or jsonb_typeof(change->'enabled') is distinct from 'boolean' then raise exception 'Control scope mismatch' using errcode='23514';end if;
 if (change->>'expiresAt')::timestamptz<=now() or change->>'expiresAt' is null then raise exception 'Control expired' using errcode='40001';end if;
 select enabled,updated_at into state_enabled,state_updated from public.routine_states
  where account_id=new.account_id and routine_id=change->>'routineId' for share;
 if not found or state_enabled is distinct from (change->>'enabled')::boolean or state_updated is distinct from (change->>'stateUpdatedAt')::timestamptz then
  raise exception 'Control settings superseded' using errcode='40001';end if;
 -- A disabled request may be recorded while paused; an enabled request may not.
 -- No function here changes routine_states or the account pause flag.
 if paused and (change->>'enabled')::boolean then raise exception 'Cannot enable paused account' using errcode='55000';end if;
 return new;
end $$;
revoke all on function public.guard_grok_control_record() from public,anon,authenticated;
grant execute on function public.guard_grok_control_record() to service_role;
create trigger grok_control_record_guard before insert on public.grok_control_records for each row execute function public.guard_grok_control_record();
