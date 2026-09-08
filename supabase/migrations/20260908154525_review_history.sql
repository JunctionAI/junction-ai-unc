-- Applied as 20260908154525. Read-only, keyset-paginated history.
create function public.read_review_history(acct uuid,generation bigint,actor uuid,output uuid,before_revision bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_review jsonb; versions jsonb; next_cursor bigint;
begin
  if before_revision is not null and before_revision<0 then
    raise exception 'Invalid history cursor' using errcode='22023';
  end if;
  -- Reuse the membership/context/source checks and their transaction-held locks.
  current_review := public.read_review_output(acct,generation,actor,output);
  if current_review is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.revision desc),'[]'::jsonb),min(v.revision)
    into versions,next_cursor from (
      select * from public.review_output_versions
      where output_id=output and account_id=acct
        and revision<=(current_review->'output'->>'revision')::bigint
        and (before_revision is null or revision<before_revision)
      order by revision desc limit 10
    ) v;
  if not exists(select 1 from public.review_output_versions where output_id=output
    and account_id=acct and revision<next_cursor) then next_cursor:=null; end if;
  return jsonb_build_object('output',current_review->'output','versions',versions,'nextCursor',next_cursor);
end $$;
revoke all on function public.read_review_history(uuid,bigint,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_review_history(uuid,bigint,uuid,uuid,bigint) to service_role;

-- Historical bytes remain private and bound to the current account generation.
create function public.read_review_version(acct uuid,generation bigint,actor uuid,output uuid,selected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_review jsonb; selected_version jsonb;
begin
  current_review:=public.read_review_output(acct,generation,actor,output);
  if current_review is null then return null; end if;
  if selected_revision is null or selected_revision<0 or selected_revision>(current_review->'output'->>'revision')::bigint
    then return null; end if;
  select to_jsonb(v) into selected_version from public.review_output_versions v
    where output_id=output and account_id=acct and revision=selected_revision;
  if selected_version is null then return null; end if;
  return jsonb_build_object('output',current_review->'output','version',selected_version);
end $$;
revoke all on function public.read_review_version(uuid,bigint,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_review_version(uuid,bigint,uuid,uuid,bigint) to service_role;
