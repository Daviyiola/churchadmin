create table public.schedule_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  show_birthdays boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.schedule_settings (org_id, show_birthdays)
select o.id, true from public.organizations o
on conflict (org_id) do nothing;

alter table public.schedule_settings enable row level security;
revoke all on table public.schedule_settings from public, anon;
grant select on table public.schedule_settings to authenticated;
create policy schedule_settings_select_staff
on public.schedule_settings for select to authenticated
using ((select public.is_org_finance(org_id)));

create or replace function public.initialize_schedule_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.schedule_settings (org_id, show_birthdays)
  values (new.id, true)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_schedule_settings()
from public, anon, authenticated, service_role;

create trigger organizations_initialize_schedule_settings
after insert on public.organizations
for each row execute function public.initialize_schedule_settings();

alter table public.schedule_coverage_requirements
  add column is_default boolean not null default false,
  alter column month_id drop not null,
  alter column requirement_date drop not null;

alter table public.schedule_coverage_requirements
  drop constraint schedule_coverage_requirement_org_id_month_id_requirement_d_key;

alter table public.schedule_coverage_requirements
  add constraint schedule_coverage_requirements_scope_check check (
    (is_default and month_id is null and requirement_date is null)
    or (not is_default and month_id is not null and requirement_date is not null)
  );

create unique index schedule_staffing_defaults_unique
on public.schedule_coverage_requirements (
  org_id, service_category_id, department_category_id, role
)
where is_default;

create unique index schedule_staffing_date_targets_unique
on public.schedule_coverage_requirements (
  org_id, requirement_date, service_category_id, department_category_id, role
)
where not is_default;

create or replace function public.validate_schedule_coverage_requirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month text;
  v_service public.categories%rowtype;
  v_department public.categories%rowtype;
begin
  if not public.is_org_finance(new.org_id) then raise exception 'Forbidden'; end if;

  if new.is_default then
    if new.month_id is not null or new.requirement_date is not null then
      raise exception 'Default staffing targets cannot contain a date.';
    end if;
  else
    select sm.month into v_month
    from public.schedule_months sm
    where sm.id = new.month_id and sm.org_id = new.org_id;
    if v_month is null or pg_catalog.to_char(new.requirement_date, 'YYYY-MM') <> v_month then
      raise exception 'Target date must belong to the selected schedule month.';
    end if;
  end if;

  select * into v_service from public.categories c where c.id = new.service_category_id;
  if v_service.org_id is distinct from new.org_id or v_service.type <> 'services' or v_service.status <> 'active' then
    raise exception 'Invalid service category.';
  end if;
  select * into v_department from public.categories c where c.id = new.department_category_id;
  if v_department.org_id is distinct from new.org_id or v_department.type <> 'department' or v_department.status <> 'active' then
    raise exception 'Invalid department category.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_schedule_coverage_requirement()
from public, anon, authenticated, service_role;

create or replace function public.upsert_schedule_staffing_target(
  p_org_id uuid,
  p_scope text,
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
set search_path = ''
as $$
declare
  v_row public.schedule_coverage_requirements;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_org_finance(p_org_id) then raise exception 'Forbidden'; end if;
  if p_scope not in ('default','date') or p_required_count not between 1 and 100 then
    raise exception 'Invalid staffing target.';
  end if;

  if p_scope = 'default' then
    insert into public.schedule_coverage_requirements (
      org_id, month_id, requirement_date, service_category_id,
      department_category_id, role, required_count, is_default, created_by, updated_by
    ) values (
      p_org_id, null, null, p_service_category_id,
      p_department_category_id, p_role, p_required_count, true, v_actor, v_actor
    )
    on conflict (org_id, service_category_id, department_category_id, role)
      where is_default
    do update set required_count = excluded.required_count,
                  updated_by = v_actor,
                  updated_at = pg_catalog.clock_timestamp()
    returning * into v_row;
  else
    if p_month_id is null or p_requirement_date is null then
      raise exception 'Choose a target date.';
    end if;
    insert into public.schedule_coverage_requirements (
      org_id, month_id, requirement_date, service_category_id,
      department_category_id, role, required_count, is_default, created_by, updated_by
    ) values (
      p_org_id, p_month_id, p_requirement_date, p_service_category_id,
      p_department_category_id, p_role, p_required_count, false, v_actor, v_actor
    )
    on conflict (org_id, requirement_date, service_category_id, department_category_id, role)
      where not is_default
    do update set month_id = excluded.month_id,
                  required_count = excluded.required_count,
                  updated_by = v_actor,
                  updated_at = pg_catalog.clock_timestamp()
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function public.upsert_schedule_staffing_target(uuid,text,uuid,date,uuid,uuid,public.schedule_role,integer)
from public, anon;
grant execute on function public.upsert_schedule_staffing_target(uuid,text,uuid,date,uuid,uuid,public.schedule_role,integer)
to authenticated;

create or replace function public.delete_schedule_coverage_requirement(p_requirement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org_id uuid;
begin
  select r.org_id into v_org_id
  from public.schedule_coverage_requirements r where r.id = p_requirement_id;
  if v_org_id is null then return; end if;
  if not public.is_org_finance(v_org_id) then raise exception 'Forbidden'; end if;
  delete from public.schedule_coverage_requirements r where r.id = p_requirement_id;
end;
$$;

revoke all on function public.delete_schedule_coverage_requirement(uuid) from public, anon;
grant execute on function public.delete_schedule_coverage_requirement(uuid) to authenticated;
