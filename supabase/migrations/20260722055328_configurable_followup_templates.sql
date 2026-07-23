create table public.followup_automation_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  step_order smallint not null,
  day_offset integer not null,
  label text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint followup_automation_templates_step_order_check
    check (step_order between 1 and 20),
  constraint followup_automation_templates_day_offset_check
    check (day_offset between 0 and 365),
  constraint followup_automation_templates_label_check
    check (char_length(btrim(label)) between 1 and 120),
  constraint followup_automation_templates_subject_check
    check (char_length(btrim(subject)) between 1 and 200),
  constraint followup_automation_templates_body_check
    check (char_length(btrim(body)) between 1 and 10000),
  constraint followup_automation_templates_org_step_key
    unique (org_id, step_order),
  constraint followup_automation_templates_org_day_key
    unique (org_id, day_offset)
);

alter table public.followup_automation_templates enable row level security;

create policy "followup_templates_select_for_org_users"
on public.followup_automation_templates
for select
to authenticated
using (
  exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = followup_automation_templates.org_id
      and uo.user_id = (select auth.uid())
  )
);

revoke all on table public.followup_automation_templates from anon;
revoke insert, update, delete on table public.followup_automation_templates from authenticated;
grant select on table public.followup_automation_templates to authenticated;

create or replace function public.save_followup_automation_templates(
  p_org_id uuid,
  p_templates jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = v_user_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Only finance, admin, or owner can manage follow-up templates';
  end if;

  if pg_catalog.jsonb_typeof(p_templates) <> 'array' then
    raise exception 'Templates must be an array';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_templates);
  if v_count < 1 or v_count > 20 then
    raise exception 'Between 1 and 20 follow-up templates are required';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtext(p_org_id::text || ':followup_templates'));

  delete from public.followup_automation_templates
  where org_id = p_org_id;

  insert into public.followup_automation_templates (
    org_id,
    step_order,
    day_offset,
    label,
    subject,
    body,
    updated_by
  )
  select
    p_org_id,
    template.step_order,
    template.day_offset,
    pg_catalog.btrim(template.label),
    pg_catalog.btrim(template.subject),
    pg_catalog.btrim(template.body),
    v_user_id
  from pg_catalog.jsonb_to_recordset(p_templates) as template(
    step_order smallint,
    day_offset integer,
    label text,
    subject text,
    body text
  );

  if not found then
    raise exception 'No valid follow-up templates were supplied';
  end if;
end;
$$;

revoke all on function public.save_followup_automation_templates(uuid, jsonb) from public;
revoke all on function public.save_followup_automation_templates(uuid, jsonb) from anon;
grant execute on function public.save_followup_automation_templates(uuid, jsonb) to authenticated;
