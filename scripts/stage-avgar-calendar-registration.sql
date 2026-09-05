-- One account-specific INACTIVE destination. No binding, allowance, workflow
-- publication, routine state or provider call is created by this transaction.
-- Standing authority: Tom's active read/draft backend-completion goal.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $$
declare acct public.accounts%rowtype; existing public.n8n_workflows%rowtype;
begin
  select * into acct from public.accounts
    where id='aa5cfc84-2569-4c99-9b40-67003ae55eda' for update;
  if acct.id is null or acct.context_generation<>1 or acct.automation_paused is distinct from true
    or acct.currency<>'NZD' or not exists(select 1 from public.account_members
      where account_id=acct.id and user_id='74802c60-149a-4405-b719-dc058d174072' and role='owner') then
    raise exception 'Current paused AVGAR owner context required';
  end if;
  if exists(select 1 from public.n8n_workflows where account_id=acct.id and routine_id='D05-W07'
    and id<>'33336ed7-41b9-410b-9560-4fdf42938e32') then
    raise exception 'Another calendar registration exists; reconcile instead of duplicating';
  end if;
  select * into existing from public.n8n_workflows
    where id='33336ed7-41b9-410b-9560-4fdf42938e32' for update;
  if found then
    if existing.account_id is distinct from acct.id or existing.routine_id is distinct from 'D05-W07'
      or existing.active is distinct from false
      or existing.webhook_url is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow' then
      raise exception 'Original staged registration changed; no automatic overwrite';
    end if;
  else
    insert into public.n8n_workflows(id,account_id,routine_id,webhook_url,active)
      values('33336ed7-41b9-410b-9560-4fdf42938e32',acct.id,'D05-W07',
      'https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow',false);
  end if;
end $$;
commit;
select id,account_id,routine_id,webhook_url,active from public.n8n_workflows
  where id='33336ed7-41b9-410b-9560-4fdf42938e32';
