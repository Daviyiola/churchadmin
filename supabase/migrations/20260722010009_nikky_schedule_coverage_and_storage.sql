begin;

create table public.schedule_coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  month_id uuid not null references public.schedule_months(id) on delete cascade,
  requirement_date date not null,
  service_category_id uuid not null references public.categories(id),
  department_category_id uuid not null references public.categories(id),
  role public.schedule_role not null,
  required_count integer not null check (required_count between 1 and 100),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, month_id, requirement_date, service_category_id, department_category_id, role)
);
create index schedule_coverage_requirements_org_date_idx
on public.schedule_coverage_requirements(org_id, requirement_date);
alter table public.schedule_coverage_requirements enable row level security;
revoke all on table public.schedule_coverage_requirements from public, anon;
grant select on table public.schedule_coverage_requirements to authenticated;
create policy schedule_coverage_requirements_select_staff
on public.schedule_coverage_requirements for select to authenticated
using (public.is_org_finance(org_id));

create or replace function public.validate_schedule_coverage_requirement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text;
  v_service_type text;
  v_service_org uuid;
  v_department_type text;
  v_department_org uuid;
begin
  if not public.is_org_finance(new.org_id) then
    raise exception 'Forbidden';
  end if;

  select sm.month into v_month
  from public.schedule_months sm
  where sm.id = new.month_id and sm.org_id = new.org_id;
  if v_month is null or to_char(new.requirement_date, 'YYYY-MM') <> v_month then
    raise exception 'Requirement date must belong to the selected schedule month.';
  end if;

  select c.type, c.org_id into v_service_type, v_service_org
  from public.categories c where c.id = new.service_category_id;
  if v_service_org is distinct from new.org_id or v_service_type <> 'services' then
    raise exception 'Invalid service category.';
  end if;

  select c.type, c.org_id into v_department_type, v_department_org
  from public.categories c where c.id = new.department_category_id;
  if v_department_org is distinct from new.org_id or v_department_type <> 'department' then
    raise exception 'Invalid department category.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_schedule_coverage_requirement() from public, anon, authenticated;
drop trigger if exists schedule_coverage_requirements_validate on public.schedule_coverage_requirements;
create trigger schedule_coverage_requirements_validate
before insert or update on public.schedule_coverage_requirements
for each row execute function public.validate_schedule_coverage_requirement();

create or replace function public.upsert_schedule_coverage_requirement(
  p_month_id uuid,
  p_requirement_date date,
  p_service_category_id uuid,
  p_department_category_id uuid,
  p_role public.schedule_role,
  p_required_count integer
)
returns public.schedule_coverage_requirements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_row public.schedule_coverage_requirements;
begin
  select org_id into v_org_id from public.schedule_months where id = p_month_id;
  if v_org_id is null or not public.is_org_finance(v_org_id) then
    raise exception 'Forbidden';
  end if;
  if p_required_count < 1 or p_required_count > 100 then
    raise exception 'Required count must be between 1 and 100.';
  end if;

  insert into public.schedule_coverage_requirements (
    org_id, month_id, requirement_date, service_category_id,
    department_category_id, role, required_count, created_by, updated_by
  ) values (
    v_org_id, p_month_id, p_requirement_date, p_service_category_id,
    p_department_category_id, p_role, p_required_count, auth.uid(), auth.uid()
  )
  on conflict (org_id, month_id, requirement_date, service_category_id, department_category_id, role)
  do update set required_count = excluded.required_count,
                updated_by = auth.uid(),
                updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.upsert_schedule_coverage_requirement(uuid,date,uuid,uuid,public.schedule_role,integer) from public, anon;
grant execute on function public.upsert_schedule_coverage_requirement(uuid,date,uuid,uuid,public.schedule_role,integer) to authenticated;

create or replace function public.delete_schedule_coverage_requirement(p_requirement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.schedule_coverage_requirements where id = p_requirement_id;
  if v_org_id is null then return; end if;
  if not public.is_org_finance(v_org_id) then raise exception 'Forbidden'; end if;
  delete from public.schedule_coverage_requirements where id = p_requirement_id;
end;
$$;
revoke all on function public.delete_schedule_coverage_requirement(uuid) from public, anon;
grant execute on function public.delete_schedule_coverage_requirement(uuid) to authenticated;

-- Private artifacts are never listed or read directly by browser roles.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nikky-reports',
  'nikky-reports',
  false,
  26214400,
  array['application/pdf','text/csv']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Database-only retention. Storage object deletion is performed by the
-- privileged application retention job before artifact metadata is removed.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.cleanup_nikky_expired_database_records()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.nikky_audit_logs
  where occurred_at < now() - interval '1 year';

  delete from public.nikky_rate_events
  where occurred_at < now() - interval '7 days';

  update public.nikky_report_confirmations
  set status = 'expired'
  where status = 'pending' and expires_at <= now();
end;
$$;
revoke all on function public.cleanup_nikky_expired_database_records() from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'nikky-database-retention';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'nikky-database-retention',
    '30 2 * * *',
    'select public.cleanup_nikky_expired_database_records()'
  );
end;
$$;

-- Tool query paths.
create index if not exists attendance_entries_org_member_date_idx
on public.attendance_entries(org_id, member_id, session_date)
where member_id is not null;
create index if not exists followup_emails_org_member_created_idx
on public.followup_emails(org_id, member_id, created_at desc);
create index if not exists schedule_entries_org_date_status_coverage_idx
on public.schedule_entries(org_id, date, status, service_category_id, department_category_id, role);

commit;
