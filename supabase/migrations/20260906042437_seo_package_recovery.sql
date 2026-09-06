alter table public.seo_work_packages add column attempt integer not null default 1 check(attempt between 1 and 2);
alter table public.seo_work_packages add column prior_results jsonb not null default '[]'::jsonb;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.guard_seo_package()'::regprocedure) into definition;
  if position('a.automation_paused or' in definition)=0 or position('Invalid SEO transition' in definition)=0 then raise exception 'Unexpected SEO guard revision'; end if;
  definition:=replace(definition,'a.automation_paused or','false or');
  definition:=replace(definition,'if tg_table_name=''seo_package_settings'' then',
    'if tg_table_name=''seo_package_settings'' then
       if a.automation_paused and new.enabled then raise exception ''SEO account paused''; end if;');
  definition:=replace(definition,'select * into k from public.artifacts',
    'if a.automation_paused then raise exception ''SEO account paused''; end if;
     select * into k from public.artifacts');
  definition:=replace(definition,'else
    if (to_jsonb(new)', 'else
    if old.status=''needs'' and new.status=''queued'' then
      if old.attempt>=2 or new.attempt<>old.attempt+1 then raise exception ''SEO retry limit''; end if;
      new.prior_results:=old.prior_results||jsonb_build_array(old.result);
      new.result:=null;new.started_at:=null;new.finished_at:=null;
    elsif new.attempt<>old.attempt or new.prior_results<>old.prior_results then raise exception ''SEO attempt immutable'';
    end if;
    if (to_jsonb(new)');
  definition:=replace(definition,'array[''status'',''result'',''started_at'',''finished_at'']','array[''status'',''result'',''started_at'',''finished_at'',''attempt'',''prior_results'']');
  definition:=replace(definition,'if not ((old.status=', 'if not ((old.status=''needs'' and new.status=''queued'') or (old.status=');
  execute definition;
end $$;
