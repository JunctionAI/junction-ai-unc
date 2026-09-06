-- Separately authorized operator previews for built-in, non-mutating manual routines.
-- This is not customer membership, routine enablement, channel authority or provider-write authority.
alter table public.ops_account_access
  add column draft_preview_granted_at timestamptz,
  add column draft_preview_granted_by uuid references auth.users(id),
  add column draft_preview_reason text,
  add column draft_preview_expires_at timestamptz,
  add constraint ops_draft_preview_grant_complete check (
    (draft_preview_granted_at is null and draft_preview_granted_by is null
      and draft_preview_reason is null and draft_preview_expires_at is null)
    or (draft_preview_granted_at is not null and draft_preview_granted_by is not null
      and draft_preview_reason is not null and length(draft_preview_reason) between 10 and 500
      and draft_preview_expires_at is not null
      and draft_preview_expires_at > draft_preview_granted_at));

create index ops_draft_preview_granter_idx on public.ops_account_access(draft_preview_granted_by);

-- Idempotency and an access audit only. The request body is intentionally not duplicated here.
create table public.ops_draft_preview_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.accounts(id),
  context_generation bigint not null check (context_generation >= 0),
  routine_id text not null check (routine_id ~ '^D0[1-5]-W[0-9]{2}$'),
  spec_hash text not null check (spec_hash ~ '^[0-9a-f]{64}$'),
  inputs_hash text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default clock_timestamp()
);
create index ops_draft_preview_account_idx on public.ops_draft_preview_requests(account_id,requested_at desc);
create index ops_draft_preview_actor_idx on public.ops_draft_preview_requests(user_id,requested_at desc);
alter table public.ops_draft_preview_requests enable row level security;
revoke all on public.ops_draft_preview_requests from public,anon,authenticated;
grant select,insert on public.ops_draft_preview_requests to service_role;

-- The API validates that the pinned catalog spec is manual, built-in and has no execute node.
-- The database binds actor/account/generation/request/spec/input identity and requires a
-- separate short-lived preview grant plus the existing work-read grant.
create function public.authorize_ops_draft_preview(
  p_user_id uuid,
  p_account_id uuid,
  p_context_generation bigint,
  p_request_id uuid,
  p_routine_id text,
  p_spec_hash text,
  p_inputs_hash text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  g public.ops_account_access%rowtype;
  a public.accounts%rowtype;
  saved public.ops_draft_preview_requests%rowtype;
begin
  select * into g from public.ops_account_access
    where user_id=p_user_id and account_id=p_account_id for share;
  select * into a from public.accounts where id=p_account_id for share;
  if not found then raise exception 'ops_draft_preview_denied' using errcode='42501'; end if;
  if g.user_id is null or g.revoked_at is not null
    or (g.expires_at is not null and g.expires_at<=clock_timestamp())
    or g.work_read_granted_at is null
    or g.draft_preview_granted_at is null
    or g.draft_preview_expires_at<=clock_timestamp() then
    raise exception 'ops_draft_preview_denied' using errcode='42501';
  end if;
  if p_context_generation<0 or p_context_generation<>a.context_generation then
    raise exception 'ops_draft_preview_context_changed' using errcode='40001';
  end if;
  if p_routine_id !~ '^D0[1-5]-W[0-9]{2}$'
    or p_spec_hash !~ '^[0-9a-f]{64}$' or p_inputs_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ops_draft_preview_invalid' using errcode='22023';
  end if;
  insert into public.ops_draft_preview_requests(request_id,user_id,account_id,context_generation,routine_id,spec_hash,inputs_hash)
    values(p_request_id,p_user_id,p_account_id,p_context_generation,p_routine_id,p_spec_hash,p_inputs_hash)
    on conflict(request_id) do nothing;
  select * into saved from public.ops_draft_preview_requests where request_id=p_request_id;
  if saved.user_id<>p_user_id or saved.account_id<>p_account_id
    or saved.context_generation<>p_context_generation or saved.routine_id<>p_routine_id
    or saved.spec_hash<>p_spec_hash or saved.inputs_hash<>p_inputs_hash then
    raise exception 'ops_draft_preview_identity_changed' using errcode='22023';
  end if;
  return jsonb_build_object('requestId',saved.request_id,'accountId',saved.account_id,
    'contextGeneration',saved.context_generation,'routineId',saved.routine_id,
    'requestedAt',saved.requested_at,'automationPaused',a.automation_paused);
end;
$$;
revoke all on function public.authorize_ops_draft_preview(uuid,uuid,bigint,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.authorize_ops_draft_preview(uuid,uuid,bigint,uuid,text,text,text) to service_role;
