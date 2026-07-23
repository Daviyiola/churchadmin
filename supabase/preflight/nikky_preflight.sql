-- Read-only checks to run immediately before applying Nikky migrations.
select current_date as database_current_date,
       current_date - 90 as finance_window_start;

select uo.role, count(*)
from public.user_organizations uo
group by uo.role
order by uo.role;

select os.organization_id, os.timezone_name, os.timezone_confirmed
from public.organization_settings os
order by os.organization_id;

select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname, arguments;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('income_entries','expense_entries','contact_messages')
order by tablename, policyname;

select count(*) as merged_members_without_survivor
from public.members m
where m.status = 'merged' and m.merged_into_member_id is null;

select count(*) as income_before_cutoff
from public.income_entries where session_date < current_date - 90;
select count(*) as expense_before_cutoff
from public.expense_entries where expense_date < current_date - 90;

select extname, extversion from pg_extension where extname = 'pg_cron';
