begin;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'nikky-database-retention';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end;
$$;

drop function if exists public.cleanup_nikky_expired_database_records();
drop function if exists public.delete_schedule_coverage_requirement(uuid);
drop function if exists public.upsert_schedule_coverage_requirement(uuid,date,uuid,uuid,public.schedule_role,integer);
drop function if exists public.validate_schedule_coverage_requirement();
drop table if exists public.schedule_coverage_requirements;

-- This rollback is only valid before any Nikky report artifacts exist. Storage
-- objects must be removed through the Storage API, never by direct SQL.
delete from storage.buckets where id = 'nikky-reports';

drop function if exists public.increment_nikky_usage(uuid,uuid,date,bigint,bigint,bigint,integer,bigint);
drop function if exists public.consume_nikky_rate_event(uuid,uuid,text,integer,integer,integer);
drop function if exists public.release_nikky_request_slot(uuid);
drop function if exists public.acquire_nikky_request_slot(uuid,uuid,uuid);
drop table if exists public.nikky_active_requests;
drop table if exists public.nikky_rate_events;
drop table if exists public.nikky_usage_monthly;
drop table if exists public.nikky_audit_logs;
drop function if exists public.guard_nikky_audit_immutability();
drop table if exists public.nikky_report_confirmations;
drop table if exists public.nikky_report_artifacts;
alter table if exists public.nikky_conversations
  drop constraint if exists nikky_conversations_summary_message_fk;
drop table if exists public.nikky_messages;
drop table if exists public.nikky_conversations;
drop table if exists public.nikky_user_contexts;
drop function if exists public.validate_organization_timezone();

alter table public.organization_settings
  drop column if exists nikky_monthly_budget_cents,
  drop column if exists nikky_enabled,
  drop column if exists timezone_confirmed,
  drop column if exists timezone_name;

drop function if exists public.finance_window_start();

-- The security-advisor hardening (fixed function search paths and revoked
-- trigger/service RPC grants) is intentionally retained.

commit;
