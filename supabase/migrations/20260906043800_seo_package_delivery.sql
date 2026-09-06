-- A package notification is bound to its saved draft and original keyword route.
create or replace function unc_private.guard_seo_package_delivery() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p public.seo_work_packages%rowtype; c public.routine_commands%rowtype; expected text;
begin
  if coalesce(new.ref,'') not like 'seo-package:%' then return new; end if;
  if TG_OP='UPDATE' and new.status is distinct from 'sending' then return new; end if;
  select * into p from public.seo_work_packages where id=substring(new.ref from 13)::uuid for share;
  if not found or p.status<>'ready' or p.account_id<>new.account_id or p.context_generation<>new.context_generation
    or p.result#>>'{artifact,meta,publishEnabled}' is distinct from 'false' then
    raise exception 'SEO draft source unavailable' using errcode='42501'; end if;
  perform 1 from public.seo_package_settings where account_id=p.account_id and context_generation=p.context_generation and enabled for share;
  if not found then raise exception 'SEO preparation disabled' using errcode='42501'; end if;
  select rc.* into c from public.routine_commands rc join public.artifacts a on a.run_id=rc.id
    where a.id=p.keyword_artifact_id and a.account_id=p.account_id and a.revision=p.keyword_revision
    and rc.account_id=p.account_id and rc.context_generation=p.context_generation and rc.user_id=p.actor_id
    and rc.routine_id='D03-W01' and rc.status='done' and rc.channel='slack' for share of rc,a;
  if not found or c.channel_binding is distinct from new.binding or new.kind<>'draft_landed' then
    raise exception 'Original SEO destination required' using errcode='42501'; end if;
  expected:='your '||p.market||' SEO drafts are ready 🔎 i''ve prepared '||jsonb_array_length(p.result#>'{artifact,items}')||' items from your keyword research and website. nothing is published. review the guide and page changes in Agents → SEO → Find searches you can win: https://junction-unc.vercel.app/app?account='||p.account_id;
  if new.payload is distinct from jsonb_build_object('text',expected) then
    raise exception 'SEO delivery must describe the saved draft' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function unc_private.guard_seo_package_delivery() from public,anon,authenticated;
create trigger channel_outbound_source_seo before insert or update on public.outbound_messages
for each row execute function unc_private.guard_seo_package_delivery();
