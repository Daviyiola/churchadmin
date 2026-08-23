alter table public.forms
  add column is_system boolean not null default false;

alter table public.form_fields
  add column is_locked boolean not null default false;

alter table public.forms
  add constraint forms_first_timer_is_system_check
  check (form_kind <> 'first_timer' or is_system);

create unique index forms_one_first_timer_per_org
  on public.forms (org_id)
  where form_kind = 'first_timer';

comment on column public.forms.is_system is
  'True for Church Admin-provided forms that cannot be deleted by ordinary form management.';
comment on column public.form_fields.is_locked is
  'True for required built-in fields whose definition and position cannot be changed in the form builder.';

create or replace function public.ensure_builtin_first_timer_form(
  p_org_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form_id uuid;
  v_fields jsonb;
begin
  if not exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('builtin-first-timer:' || p_org_id::text, 0)
  );

  select f.id into v_form_id
  from public.forms f
  where f.org_id = p_org_id
    and f.form_kind = 'first_timer';

  if v_form_id is not null then
    return v_form_id;
  end if;

  insert into public.forms (
    org_id, title, description, status, form_kind, is_system, slug,
    created_by, updated_by
  ) values (
    p_org_id,
    'Thank you for joining us today!',
    'Your presence was truly refreshing. Please take a few minutes to complete your details.',
    'draft',
    'first_timer',
    true,
    'first-timers-' || p_org_id::text,
    p_actor_id,
    p_actor_id
  ) returning id into v_form_id;

  insert into public.form_fields (
    form_id, org_id, field_key, field_type, label, help_text,
    placeholder, is_required, options, layout_width, position, is_locked
  ) values
    (v_form_id, p_org_id, gen_random_uuid(), 'short_text', 'First name', null, 'First name', true, '[]'::jsonb, 'half', 0, true),
    (v_form_id, p_org_id, gen_random_uuid(), 'short_text', 'Last name', null, 'Last name', true, '[]'::jsonb, 'half', 1, true),
    (v_form_id, p_org_id, gen_random_uuid(), 'email', 'Email', null, 'you@example.com', true, '[]'::jsonb, 'half', 2, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'phone', 'Phone', null, '(555) 555-5555', true, '[]'::jsonb, 'half', 3, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'dropdown', 'Gender', null, null, true, '["Male", "Female"]'::jsonb, 'half', 4, true),
    (v_form_id, p_org_id, gen_random_uuid(), 'dropdown', 'Age group', null, null, true, '["1-12", "13-17", "18-35", "36+"]'::jsonb, 'half', 5, true),
    (v_form_id, p_org_id, gen_random_uuid(), 'short_text', 'Home address', null, 'Street address', false, '[]'::jsonb, 'full', 6, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'short_text', 'Marital status', null, 'e.g., Single, Married', false, '[]'::jsonb, 'half', 7, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'number', 'Children count', null, '0', false, '[]'::jsonb, 'half', 8, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'short_text', 'How did you hear about us?', null, 'Invited by a friend, social media, flyer...', false, '[]'::jsonb, 'full', 9, false),
    (v_form_id, p_org_id, gen_random_uuid(), 'long_text', 'Prayer requests', 'Add as many as you would like.', 'Family', false, '[]'::jsonb, 'full', 10, false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', ff.field_key,
    'type', ff.field_type,
    'label', ff.label,
    'help_text', ff.help_text,
    'placeholder', ff.placeholder,
    'required', ff.is_required,
    'options', ff.options,
    'width', ff.layout_width,
    'locked', ff.is_locked
  ) order by ff.position), '[]'::jsonb)
  into v_fields
  from public.form_fields ff
  where ff.form_id = v_form_id;

  insert into public.form_revisions (
    form_id, org_id, revision, action, title, description,
    status, fields_snapshot, actor_id
  ) values (
    v_form_id,
    p_org_id,
    1,
    'created',
    'Thank you for joining us today!',
    'Your presence was truly refreshing. Please take a few minutes to complete your details.',
    'draft',
    v_fields,
    p_actor_id
  );

  return v_form_id;
end;
$$;

create or replace function public.provision_builtin_first_timer_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('owner', 'admin', 'finance') then
    perform public.ensure_builtin_first_timer_form(
      new.organization_id,
      new.user_id
    );
  end if;
  return new;
end;
$$;

create trigger user_organizations_provision_first_timer_form
after insert or update of role on public.user_organizations
for each row
execute function public.provision_builtin_first_timer_form();

create or replace function public.prevent_builtin_form_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_system and pg_catalog.pg_trigger_depth() = 1 then
    raise exception 'Built-in forms cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger forms_prevent_builtin_delete
before delete on public.forms
for each row
execute function public.prevent_builtin_form_delete();

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
    from public.forms f
    where f.org_id = p_org_id
      and not f.is_system;
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
  v_locked_keys uuid[];
  v_fields_snapshot jsonb;
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
           'required', 'options', 'width', 'locked'
         )
       )
       or coalesce(v_item->>'key', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_item->>'type', '') not in (
         'short_text', 'long_text', 'email', 'phone', 'number', 'date',
         'single_choice', 'multiple_choice', 'dropdown', 'yes_no'
       )
       or coalesce(v_item->>'width', 'full') not in ('full', 'half')
       or char_length(pg_catalog.btrim(coalesce(v_item->>'label', ''))) not between 1 and 160
       or char_length(coalesce(v_item->>'help_text', '')) > 500
       or char_length(coalesce(v_item->>'placeholder', '')) > 200
       or jsonb_typeof(coalesce(v_item->'required', 'false'::jsonb)) <> 'boolean'
       or jsonb_typeof(coalesce(v_item->'locked', 'false'::jsonb)) <> 'boolean'
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

  if exists (
    select 1
    from public.form_fields ff
    where ff.form_id = p_form_id
      and ff.is_locked
      and not exists (
        select 1
        from jsonb_array_elements(p_fields) with ordinality submitted(item, ordinality)
        where submitted.item->>'key' = ff.field_key::text
          and submitted.item->>'type' = ff.field_type
          and pg_catalog.btrim(submitted.item->>'label') = ff.label
          and nullif(pg_catalog.btrim(coalesce(submitted.item->>'help_text', '')), '') is not distinct from ff.help_text
          and nullif(pg_catalog.btrim(coalesce(submitted.item->>'placeholder', '')), '') is not distinct from ff.placeholder
          and coalesce((submitted.item->>'required')::boolean, false) = ff.is_required
          and coalesce(submitted.item->'options', '[]'::jsonb) = ff.options
          and coalesce(submitted.item->>'width', 'full') = ff.layout_width
          and submitted.ordinality::integer - 1 = ff.position
      )
  ) then
    raise exception 'Built-in form fields cannot be changed or removed';
  end if;

  select coalesce(array_agg(ff.field_key), '{}'::uuid[])
  into v_locked_keys
  from public.form_fields ff
  where ff.form_id = p_form_id
    and ff.is_locked;

  delete from public.form_fields ff where ff.form_id = p_form_id;

  insert into public.form_fields (
    form_id, org_id, field_key, field_type, label, help_text,
    placeholder, is_required, options, layout_width, position, is_locked
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
    coalesce(item->>'width', 'full'),
    ordinality::integer - 1,
    (item->>'key')::uuid = any(v_locked_keys)
  from jsonb_array_elements(p_fields) with ordinality as items(item, ordinality);

  v_next_revision := v_form.revision + 1;
  update public.forms
  set title = pg_catalog.btrim(p_title),
      description = nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
      revision = v_next_revision,
      updated_by = p_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_form_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', ff.field_key,
    'type', ff.field_type,
    'label', ff.label,
    'help_text', ff.help_text,
    'placeholder', ff.placeholder,
    'required', ff.is_required,
    'options', ff.options,
    'width', ff.layout_width,
    'locked', ff.is_locked
  ) order by ff.position), '[]'::jsonb)
  into v_fields_snapshot
  from public.form_fields ff
  where ff.form_id = p_form_id;

  insert into public.form_revisions (
    form_id, org_id, revision, action, title, description,
    status, fields_snapshot, actor_id
  ) values (
    p_form_id, v_form.org_id, v_next_revision, 'edited',
    pg_catalog.btrim(p_title),
    nullif(pg_catalog.btrim(coalesce(p_description, '')), ''),
    v_form.status, v_fields_snapshot, p_actor_id
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
    'options', ff.options,
    'width', ff.layout_width,
    'locked', ff.is_locked
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

do $$
declare
  v_org record;
begin
  for v_org in
    select distinct on (uo.organization_id)
      uo.organization_id,
      uo.user_id
    from public.user_organizations uo
    where uo.role in ('owner', 'admin', 'finance')
    order by uo.organization_id,
      case uo.role when 'owner' then 1 when 'admin' then 2 else 3 end,
      uo.user_id
  loop
    perform public.ensure_builtin_first_timer_form(
      v_org.organization_id,
      v_org.user_id
    );
  end loop;
end;
$$;

revoke all on function public.ensure_builtin_first_timer_form(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.provision_builtin_first_timer_form()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_builtin_form_delete()
  from public, anon, authenticated, service_role;

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
