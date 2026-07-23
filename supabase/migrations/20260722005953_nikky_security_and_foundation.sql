begin;

-- Public contact submissions are written only by the server-side service client.
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from public, anon, authenticated;

-- Retire the unused dashboard SECURITY DEFINER endpoints. They accepted a caller
-- supplied organization id and bypassed the finance date-window RLS policies.
revoke all on function public.dashboard_kpis(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dashboard_monthly_totals(uuid, integer) from public, anon, authenticated;
revoke all on function public.dashboard_recent_published_agg(uuid, integer) from public, anon, authenticated;
revoke all on function public.dashboard_year_totals(uuid, integer) from public, anon, authenticated;

-- Financial SELECT access is expressed once per table. Finance is deliberately
-- constrained by the existing database interpretation: current_date - 90.
drop policy if exists income_entries_select_admin_all on public.income_entries;
drop policy if exists income_entries_select_finance_40d on public.income_entries;
drop policy if exists income_entries_select_authorized on public.income_entries;
create policy income_entries_select_authorized
on public.income_entries
for select
to authenticated
using (
  public.is_org_admin(org_id)
  or (
    public.is_org_finance(org_id)
    and public.within_finance_window(session_date)
  )
);

drop policy if exists expense_entries_select_admin_all on public.expense_entries;
drop policy if exists expense_entries_select_finance_40d on public.expense_entries;
drop policy if exists expense_entries_select_authorized on public.expense_entries;
create policy expense_entries_select_authorized
on public.expense_entries
for select
to authenticated
using (
  public.is_org_admin(org_id)
  or (
    public.is_org_finance(org_id)
    and public.within_finance_window(expense_date)
  )
);

create or replace function public.finance_window_start()
returns date
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select current_date - 90;
$$;
revoke all on function public.finance_window_start() from public, anon;
grant execute on function public.finance_window_start() to authenticated, service_role;

-- Fix mutable search paths on privileged functions and remove anonymous access
-- except for the two intentionally token-gated public workflows.
alter function public.add_expense_negative_adjustment(uuid,date,uuid,text,text,text,text,integer,text) set search_path = public, pg_temp;
alter function public.add_expense_post_publication(uuid,uuid,date,uuid,text,text,integer,text,text,text) set search_path = public, pg_temp;
alter function public.add_income_negative_adjustment(uuid,uuid,uuid,text,text,integer,text) set search_path = public, pg_temp;
alter function public.add_income_post_publication(uuid,uuid,uuid,uuid,text,integer,text,text) set search_path = public, pg_temp;
alter function public.append_expense_import_job(uuid) set search_path = public, pg_temp;
alter function public.edit_expense_entry_logged(uuid,uuid,uuid,integer,text) set search_path = public, pg_temp;
alter function public.edit_income_entry_logged(uuid,uuid,uuid,integer,text) set search_path = public, pg_temp;
alter function public.edit_published_attendance_session(uuid,uuid,date,text) set search_path = public, pg_temp;
alter function public.edit_published_income_batch(uuid,uuid,date,text) set search_path = public, pg_temp;
alter function public.ensure_schedule_month(uuid,text) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.intake_token_consume(text) set search_path = public, pg_temp;
alter function public.intake_token_lookup(text) set search_path = public, pg_temp;
alter function public.merge_members(uuid,uuid,text[],text,boolean) set search_path = public, pg_temp;
alter function public.preview_member_merge(uuid,uuid) set search_path = public, pg_temp;
alter function public.publish_attendance_session(uuid) set search_path = public, pg_temp;
alter function public.publish_expense_draft(uuid) set search_path = public, pg_temp;
alter function public.publish_income_batch(uuid,uuid) set search_path = public, pg_temp;
alter function public.publish_income_draft(uuid) set search_path = public, pg_temp;
alter function public.reject_merged_member_reference() set search_path = public, pg_temp;
alter function public.revert_attendance_session_to_draft(uuid) set search_path = public, pg_temp;
alter function public.schedule_set_month_code(uuid,text) set search_path = public, pg_temp;
alter function public.schedule_verify_month_code(uuid,text,text) set search_path = public, pg_temp;
alter function public.soft_delete_attendance_session(uuid) set search_path = public, pg_temp;
alter function public.tg_bump_attendance_session_from_draft() set search_path = public, pg_temp;

revoke all on function public.add_expense_negative_adjustment(uuid,date,uuid,text,text,text,text,integer,text) from public, anon;
revoke all on function public.add_expense_post_publication(uuid,uuid,date,uuid,text,text,integer,text,text,text) from public, anon;
revoke all on function public.add_income_negative_adjustment(uuid,uuid,uuid,text,text,integer,text) from public, anon;
revoke all on function public.add_income_post_publication(uuid,uuid,uuid,uuid,text,integer,text,text) from public, anon;
revoke all on function public.append_expense_import_job(uuid) from public, anon;
revoke all on function public.edit_expense_entry_logged(uuid,uuid,uuid,integer,text) from public, anon;
revoke all on function public.edit_income_entry_logged(uuid,uuid,uuid,integer,text) from public, anon;
revoke all on function public.edit_published_attendance_session(uuid,uuid,date,text) from public, anon;
revoke all on function public.edit_published_income_batch(uuid,uuid,date,text) from public, anon;
revoke all on function public.ensure_schedule_month(uuid,text) from public, anon;
revoke all on function public.merge_members(uuid,uuid,text[],text,boolean) from public, anon;
revoke all on function public.preview_member_merge(uuid,uuid) from public, anon;
revoke all on function public.publish_attendance_session(uuid) from public, anon;
revoke all on function public.publish_expense_draft(uuid) from public, anon;
revoke all on function public.publish_income_batch(uuid,uuid) from public, anon;
revoke all on function public.publish_income_draft(uuid) from public, anon;
revoke all on function public.revert_attendance_session_to_draft(uuid) from public, anon;
revoke all on function public.schedule_set_month_code(uuid,text) from public, anon;
revoke all on function public.soft_delete_attendance_session(uuid) from public, anon;

grant execute on function public.add_expense_negative_adjustment(uuid,date,uuid,text,text,text,text,integer,text) to authenticated;
grant execute on function public.add_expense_post_publication(uuid,uuid,date,uuid,text,text,integer,text,text,text) to authenticated;
grant execute on function public.add_income_negative_adjustment(uuid,uuid,uuid,text,text,integer,text) to authenticated;
grant execute on function public.add_income_post_publication(uuid,uuid,uuid,uuid,text,integer,text,text) to authenticated;
grant execute on function public.append_expense_import_job(uuid) to authenticated;
grant execute on function public.edit_expense_entry_logged(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.edit_income_entry_logged(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.edit_published_attendance_session(uuid,uuid,date,text) to authenticated;
grant execute on function public.edit_published_income_batch(uuid,uuid,date,text) to authenticated;
grant execute on function public.ensure_schedule_month(uuid,text) to authenticated;
grant execute on function public.merge_members(uuid,uuid,text[],text,boolean) to authenticated;
grant execute on function public.preview_member_merge(uuid,uuid) to authenticated;
grant execute on function public.publish_attendance_session(uuid) to authenticated;
grant execute on function public.publish_expense_draft(uuid) to authenticated;
grant execute on function public.publish_income_batch(uuid,uuid) to authenticated;
grant execute on function public.publish_income_draft(uuid) to authenticated;
grant execute on function public.revert_attendance_session_to_draft(uuid) to authenticated;
grant execute on function public.schedule_set_month_code(uuid,text) to authenticated;
grant execute on function public.soft_delete_attendance_session(uuid) to authenticated;

-- Trigger functions are not client-callable.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.reject_merged_member_reference() from public, anon, authenticated;
revoke all on function public.tg_bump_attendance_session_from_draft() from public, anon, authenticated;

-- Token-gated public operations remain callable but have fixed search paths.
revoke all on function public.intake_token_lookup(text) from public;
revoke all on function public.intake_token_consume(text) from public;
revoke all on function public.schedule_verify_month_code(uuid,text,text) from public;
grant execute on function public.intake_token_lookup(text) to anon, authenticated;
grant execute on function public.intake_token_consume(text) to anon, authenticated;
grant execute on function public.schedule_verify_month_code(uuid,text,text) to anon, authenticated;

commit;
