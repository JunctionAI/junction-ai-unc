-- Narrow server-to-server read contract from Mission Control to Unc.
-- Grant rows are provisioned separately after exact cross-project identity review.
create table junction.unc_source_read_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  source_project text not null check (source_project = 'ebcatvidixdjjwmmades'),
  source_kind text not null check (source_kind in ('public.client_accounts','junction.client_orgs')),
  source_key text not null check (length(source_key) between 1 and 200 and source_key !~ '[[:space:]]'),
  warehouse_schema text not null check (warehouse_schema in ('h1','dbh','nzph')),
  dataset text not null check (dataset = 'email_campaigns'),
  granted_at timestamptz not null default now(),
  granted_by text not null check (length(btrim(granted_by)) between 3 and 200),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  revoked_at timestamptz,
  unique (account_id,dataset),
  unique (source_project,source_kind,source_key,dataset)
);
alter table junction.unc_source_read_grants enable row level security;
revoke all on junction.unc_source_read_grants from public,anon,authenticated;
grant select,insert,update on junction.unc_source_read_grants to service_role;

create function public.read_unc_source_email_campaigns(
  p_account_id uuid,
  p_source_project text,
  p_source_kind text,
  p_source_key text,
  p_limit integer default 500
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  grant_row junction.unc_source_read_grants%rowtype;
  result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_source_read_limit' using errcode='22023';
  end if;
  select * into grant_row from junction.unc_source_read_grants
    where account_id=p_account_id and source_project=p_source_project
      and source_kind=p_source_kind and source_key=p_source_key
      and dataset='email_campaigns' and revoked_at is null;
  if grant_row.id is null then
    raise exception 'source_read_not_granted' using errcode='42501';
  end if;

  execute format($query$
    with selected as (
      select id::text id, campaign_id::text campaign_id, message_id::text message_id,
        name, subject, preview_text, sent_at, segment, recipients,
        open_rate, click_rate, placed_order_rate, unsubscribe_rate,
        spam_rate, bounce_rate, revenue, metrics_updated_at, updated_at
      from %I.email_campaigns
      where sent_at is not null
      order by sent_at desc, id desc
      limit $5
    )
    select jsonb_build_object(
      'contract','junction.source.email-campaigns.v1',
      'accountId',$1,
      'sourceProject',$2,
      'sourceKind',$3,
      'sourceKey',$4,
      'dataset','email_campaigns',
      'sourceRowCount',(select count(*) from %I.email_campaigns where sent_at is not null),
      'sourceMaxUpdatedAt',(select max(coalesce(metrics_updated_at,updated_at,sent_at)) from %I.email_campaigns where sent_at is not null),
      'rows',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'campaignId',campaign_id,'messageId',message_id,'name',name,
        'subject',subject,'previewText',preview_text,'sentAt',sent_at,'segment',segment,
        'recipients',recipients,'openRate',open_rate,'clickRate',click_rate,
        'placedOrderRate',placed_order_rate,'unsubscribeRate',unsubscribe_rate,
        'spamRate',spam_rate,'bounceRate',bounce_rate,'revenue',revenue,
        'metricsUpdatedAt',metrics_updated_at,'updatedAt',updated_at
      ) order by sent_at desc,id desc) from selected),'[]'::jsonb)
    )
  $query$, grant_row.warehouse_schema, grant_row.warehouse_schema, grant_row.warehouse_schema)
  into result using p_account_id,p_source_project,p_source_kind,p_source_key,p_limit;
  return result;
end;
$$;
revoke all on function public.read_unc_source_email_campaigns(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.read_unc_source_email_campaigns(uuid,text,text,text,integer) to service_role;
