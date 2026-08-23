-- Read-only checks to run immediately before Phase 0 intake migration.

select 'token_org_mismatch' as check_name, count(*)::bigint as issue_count
from public.intake_tokens t
join public.members m on m.id = t.member_id
where t.org_id <> m.org_id
union all
select 'active_tokens_for_merged_members', count(*)::bigint
from public.intake_tokens t
join public.members m on m.id = t.member_id
where t.used_at is null and t.expires_at > now() and m.status = 'merged'
union all
select 'invalid_followup_timezones', count(*)::bigint
from public.followup_settings fs
where not exists (
  select 1 from pg_catalog.pg_timezone_names tz where tz.name = fs.timezone_name
)
union all
select 'automation_orgs_without_templates', count(*)::bigint
from public.followup_settings fs
where fs.automation_enabled
  and not exists (
    select 1 from public.followup_automation_templates t where t.org_id = fs.org_id
  )
union all
select 'campaigns_over_ui_limit', count(*)::bigint
from public.intake_campaigns c
where c.expires_at > c.created_at + interval '9999 days';

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proacl, ','), '') as grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('intake_token_lookup', 'intake_token_consume')
order by p.proname;

