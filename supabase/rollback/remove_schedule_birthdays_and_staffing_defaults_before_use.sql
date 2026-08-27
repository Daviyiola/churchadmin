begin;

do $$
begin
  if exists (
    select 1 from public.schedule_coverage_requirements where is_default
  ) then
    raise exception 'Rollback stopped: default staffing targets already exist.';
  end if;
end;
$$;

drop trigger if exists organizations_initialize_schedule_settings on public.organizations;
drop function if exists public.initialize_schedule_settings();
drop table if exists public.schedule_settings;

revoke all on function public.upsert_schedule_staffing_target(uuid,text,uuid,date,uuid,uuid,public.schedule_role,integer)
from public, anon, authenticated;
drop function public.upsert_schedule_staffing_target(uuid,text,uuid,date,uuid,uuid,public.schedule_role,integer);

drop index if exists public.schedule_staffing_defaults_unique;
drop index if exists public.schedule_staffing_date_targets_unique;
alter table public.schedule_coverage_requirements
  drop constraint if exists schedule_coverage_requirements_scope_check,
  alter column month_id set not null,
  alter column requirement_date set not null,
  drop column is_default;

alter table public.schedule_coverage_requirements
  add constraint schedule_coverage_requirement_org_id_month_id_requirement_d_key
  unique (org_id, month_id, requirement_date, service_category_id, department_category_id, role);

commit;
