alter table public.plan_entitlements
  add column form_count_limit integer;

alter table public.plan_entitlements
  add constraint plan_entitlements_form_count_limit_check
  check (form_count_limit is null or form_count_limit >= 1);

comment on column public.plan_entitlements.form_count_limit is
  'Maximum non-deleted forms an organization may create. NULL means unlimited until plan limits are configured.';

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',
  form_kind text not null default 'generic',
  slug text not null unique,
  revision integer not null default 1,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forms_id_org_unique unique (id, org_id),
  constraint forms_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint forms_description_check
    check (description is null or char_length(description) <= 2000),
  constraint forms_status_check
    check (status in ('draft', 'open', 'closed')),
  constraint forms_kind_check
    check (form_kind in ('generic', 'first_timer', 'member_update', 'attendance')),
  constraint forms_revision_check check (revision >= 1)
);

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  org_id uuid not null,
  field_key uuid not null,
  field_type text not null,
  label text not null,
  help_text text,
  placeholder text,
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_fields_form_org_fk
    foreign key (form_id, org_id)
    references public.forms(id, org_id) on delete cascade,
  constraint form_fields_form_key_unique unique (form_id, field_key),
  constraint form_fields_form_position_unique unique (form_id, position),
  constraint form_fields_type_check check (
    field_type in (
      'short_text', 'long_text', 'email', 'phone', 'number', 'date',
      'single_choice', 'multiple_choice', 'dropdown', 'yes_no'
    )
  ),
  constraint form_fields_label_check
    check (char_length(btrim(label)) between 1 and 160),
  constraint form_fields_help_check
    check (help_text is null or char_length(help_text) <= 500),
  constraint form_fields_placeholder_check
    check (placeholder is null or char_length(placeholder) <= 200),
  constraint form_fields_options_array_check
    check (jsonb_typeof(options) = 'array'),
  constraint form_fields_position_check check (position >= 0)
);

create table public.form_revisions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  org_id uuid not null,
  revision integer not null,
  action text not null,
  title text not null,
  description text,
  status text not null,
  fields_snapshot jsonb not null default '[]'::jsonb,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint form_revisions_form_org_fk
    foreign key (form_id, org_id)
    references public.forms(id, org_id) on delete cascade,
  constraint form_revisions_form_revision_unique unique (form_id, revision),
  constraint form_revisions_action_check
    check (action in ('created', 'edited', 'opened', 'closed', 'reopened')),
  constraint form_revisions_fields_array_check
    check (jsonb_typeof(fields_snapshot) = 'array')
);

create index forms_org_status_updated_idx
  on public.forms (org_id, status, updated_at desc);
create index form_fields_org_form_position_idx
  on public.form_fields (org_id, form_id, position);
create index form_revisions_org_form_created_idx
  on public.form_revisions (org_id, form_id, created_at desc);
create index forms_created_by_idx on public.forms (created_by);
create index forms_updated_by_idx on public.forms (updated_by);
create index form_revisions_actor_id_idx on public.form_revisions (actor_id);

alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_revisions enable row level security;

revoke all on table public.forms from public, anon, authenticated;
revoke all on table public.form_fields from public, anon, authenticated;
revoke all on table public.form_revisions from public, anon, authenticated;
grant select on table public.forms to authenticated;
grant select on table public.form_fields to authenticated;
grant select on table public.form_revisions to authenticated;
grant select, insert, update, delete on table public.forms to service_role;
grant select, insert, update, delete on table public.form_fields to service_role;
grant select, insert, update, delete on table public.form_revisions to service_role;

create policy forms_select_managers
on public.forms for select to authenticated
using ((select public.is_org_finance(org_id)));

create policy form_fields_select_managers
on public.form_fields for select to authenticated
using ((select public.is_org_finance(org_id)));

create policy form_revisions_select_managers
on public.form_revisions for select to authenticated
using ((select public.is_org_finance(org_id)));

create or replace function public.create_managed_form(
  p_org_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form_id uuid;
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;

  if nullif(pg_catalog.btrim(p_title), '') is null
     or char_length(pg_catalog.btrim(p_title)) > 120
     or char_length(coalesce(p_description, '')) > 2000
     or p_slug !~ '^[a-z0-9][a-z0-9-]{7,79}$' then
    raise exception 'Invalid form details';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('forms:' || p_org_id::text, 0)
  );

  select case
    when op.plan = 'growth' then 'pro'
    when op.plan in ('free', 'basic', 'pro', 'enterprise') then op.plan
    else 'basic'
  end into v_plan
  from public.org_plans op
  where op.organization_id = p_org_id;

  v_plan := coalesce(v_plan, 'basic');
  select pe.form_count_limit into v_limit
  from public.plan_entitlements pe
  where pe.plan_key = v_plan;

  if v_limit is not null then
    select count(*)::integer into v_count
    from public.forms f where f.org_id = p_org_id;
    if v_count >= v_limit then
      raise exception 'FORM_PLAN_LIMIT_REACHED';
    end if;
  end if;

  insert into public.forms (
    org_id, title, description, slug, created_by, updated_by
  ) values (
    p_org_id,
    pg_catalog.btrim(p_title),
    nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
    p_slug,
    p_actor_id,
    p_actor_id
  ) returning id into v_form_id;

  insert into public.form_revisions (
    form_id, org_id, revision, action, title, description,
    status, fields_snapshot, actor_id
  ) values (
    v_form_id, p_org_id, 1, 'created', pg_catalog.btrim(p_title),
    nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
    'draft', '[]'::jsonb, p_actor_id
  );

  return v_form_id;
end;
$$;

create or replace function public.save_managed_form(
  p_form_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_fields jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_next_revision integer;
  v_item jsonb;
  v_options jsonb;
begin
  select * into v_form from public.forms f
  where f.id = p_form_id for update;

  if v_form.id is null then raise exception 'Form not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_form.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;
  if v_form.status = 'closed' then
    raise exception 'Reopen the form before editing it';
  end if;
  if nullif(pg_catalog.btrim(p_title), '') is null
     or char_length(pg_catalog.btrim(p_title)) > 120
     or char_length(coalesce(p_description, '')) > 2000
     or p_fields is null
     or jsonb_typeof(p_fields) <> 'array'
     or jsonb_array_length(p_fields) > 50 then
    raise exception 'Invalid form details';
  end if;

  for v_item in select value from jsonb_array_elements(p_fields)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_item) k
         where k not in (
           'key', 'type', 'label', 'help_text', 'placeholder',
           'required', 'options'
         )
       )
       or coalesce(v_item->>'key', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_item->>'type', '') not in (
         'short_text', 'long_text', 'email', 'phone', 'number', 'date',
         'single_choice', 'multiple_choice', 'dropdown', 'yes_no'
       )
       or char_length(pg_catalog.btrim(coalesce(v_item->>'label', ''))) not between 1 and 160
       or char_length(coalesce(v_item->>'help_text', '')) > 500
       or char_length(coalesce(v_item->>'placeholder', '')) > 200
       or jsonb_typeof(coalesce(v_item->'required', 'false'::jsonb)) <> 'boolean'
       or jsonb_typeof(coalesce(v_item->'options', '[]'::jsonb)) <> 'array' then
      raise exception 'Invalid form field';
    end if;

    v_options := coalesce(v_item->'options', '[]'::jsonb);
    if jsonb_array_length(v_options) > 50
       or (
         select count(*) <> count(distinct pg_catalog.lower(pg_catalog.btrim(value)))
         from jsonb_array_elements_text(v_options)
       )
       or exists (
         select 1 from jsonb_array_elements(v_options) o
         where jsonb_typeof(o) <> 'string'
            or char_length(pg_catalog.btrim(o #>> '{}')) not between 1 and 120
       )
       or (
         v_item->>'type' in ('single_choice', 'multiple_choice', 'dropdown')
         and jsonb_array_length(v_options) < 1
       )
       or (
         v_item->>'type' not in ('single_choice', 'multiple_choice', 'dropdown')
         and jsonb_array_length(v_options) <> 0
       ) then
      raise exception 'Invalid form field options';
    end if;
  end loop;

  if (
    select count(*) from (
      select value->>'key' from jsonb_array_elements(p_fields)
      group by value->>'key' having count(*) > 1
    ) duplicates
  ) > 0 then raise exception 'Duplicate form field key'; end if;

  delete from public.form_fields ff where ff.form_id = p_form_id;

  insert into public.form_fields (
    form_id, org_id, field_key, field_type, label, help_text,
    placeholder, is_required, options, position
  )
  select
    p_form_id,
    v_form.org_id,
    (item->>'key')::uuid,
    item->>'type',
    pg_catalog.btrim(item->>'label'),
    nullif(pg_catalog.btrim(coalesce(item->>'help_text', '')), ''),
    nullif(pg_catalog.btrim(coalesce(item->>'placeholder', '')), ''),
    coalesce((item->>'required')::boolean, false),
    coalesce(item->'options', '[]'::jsonb),
    ordinality::integer - 1
  from jsonb_array_elements(p_fields) with ordinality as items(item, ordinality);

  v_next_revision := v_form.revision + 1;
  update public.forms
  set title = pg_catalog.btrim(p_title),
      description = nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
      revision = v_next_revision,
      updated_by = p_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_form_id;

  insert into public.form_revisions (
    form_id, org_id, revision, action, title, description,
    status, fields_snapshot, actor_id
  ) values (
    p_form_id, v_form.org_id, v_next_revision, 'edited',
    pg_catalog.btrim(p_title),
    nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
    v_form.status, p_fields, p_actor_id
  );

  return v_next_revision;
end;
$$;

create or replace function public.set_managed_form_status(
  p_form_id uuid,
  p_actor_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_next_revision integer;
  v_action text;
  v_fields jsonb;
begin
  select * into v_form from public.forms f
  where f.id = p_form_id for update;

  if v_form.id is null then raise exception 'Form not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_form.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;
  if p_status not in ('open', 'closed') or p_status = v_form.status then
    raise exception 'Invalid form status change';
  end if;
  if p_status = 'open' and not exists (
    select 1 from public.form_fields ff where ff.form_id = p_form_id
  ) then raise exception 'Add at least one field before opening the form'; end if;

  v_action := case when p_status = 'closed' then 'closed'
    when v_form.status = 'closed' then 'reopened' else 'opened' end;
  v_next_revision := v_form.revision + 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', ff.field_key,
    'type', ff.field_type,
    'label', ff.label,
    'help_text', ff.help_text,
    'placeholder', ff.placeholder,
    'required', ff.is_required,
    'options', ff.options
  ) order by ff.position), '[]'::jsonb)
  into v_fields
  from public.form_fields ff where ff.form_id = p_form_id;

  update public.forms
  set status = p_status,
      revision = v_next_revision,
      opened_at = case when p_status = 'open'
        then coalesce(opened_at, pg_catalog.clock_timestamp()) else opened_at end,
      closed_at = case when p_status = 'closed'
        then pg_catalog.clock_timestamp() else null end,
      updated_by = p_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_form_id;

  insert into public.form_revisions (
    form_id, org_id, revision, action, title, description,
    status, fields_snapshot, actor_id
  ) values (
    p_form_id, v_form.org_id, v_next_revision, v_action,
    v_form.title, v_form.description, p_status, v_fields, p_actor_id
  );

  return v_next_revision;
end;
$$;

revoke all on function public.create_managed_form(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.save_managed_form(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.set_managed_form_status(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_managed_form(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.save_managed_form(uuid, uuid, text, text, jsonb)
  to service_role;
grant execute on function public.set_managed_form_status(uuid, uuid, text)
  to service_role;
