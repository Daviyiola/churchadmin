begin;

-- Pin every application function's name resolution. This is deliberately
-- applied to all public functions so future calls cannot inherit a caller-
-- controlled search_path. Function bodies currently use public objects.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', v_function);
  end loop;
end;
$$;

-- Trigger-only and server-accounting functions are not client RPCs.
revoke all on function public.enforce_max_10_expense_drafts() from public, anon, authenticated;
revoke all on function public.enforce_max_10_income_drafts() from public, anon, authenticated;
revoke all on function public.ensure_org_settings() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.schedule_entries_validate_categories() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.increment_campaign_failure(uuid) from public, anon, authenticated;
revoke all on function public.increment_campaign_success(uuid) from public, anon, authenticated;
revoke all on function public.increment_org_burst_minute(uuid,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.increment_org_month_usage(uuid,date,integer) from public, anon, authenticated;

commit;
