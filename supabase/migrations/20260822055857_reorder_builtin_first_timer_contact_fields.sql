update public.form_fields ff
set position = position + 100,
    updated_at = pg_catalog.clock_timestamp()
from public.forms f
where f.id = ff.form_id
  and f.form_kind = 'first_timer'
  and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

update public.form_fields ff
set position = case ff.label
      when 'Gender' then 2
      when 'Age group' then 3
      when 'Email' then 4
      when 'Phone' then 5
    end,
    updated_at = pg_catalog.clock_timestamp()
from public.forms f
where f.id = ff.form_id
  and f.form_kind = 'first_timer'
  and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

with changed as (
  update public.forms f
  set revision = f.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where f.form_kind = 'first_timer'
  returning f.*
)
insert into public.form_revisions (
  form_id, org_id, revision, action, title, description,
  status, fields_snapshot, actor_id
)
select
  changed.id,
  changed.org_id,
  changed.revision,
  'edited',
  changed.title,
  changed.description,
  changed.status,
  coalesce(fields.snapshot, '[]'::jsonb),
  changed.updated_by
from changed
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'key', ff.field_key,
    'type', ff.field_type,
    'label', ff.label,
    'help_text', ff.help_text,
    'placeholder', ff.placeholder,
    'required', ff.is_required,
    'options', ff.options,
    'width', ff.layout_width,
    'locked', ff.is_locked
  ) order by ff.position) as snapshot
  from public.form_fields ff
  where ff.form_id = changed.id
) fields on true;

create or replace function public.normalize_builtin_first_timer_field_order(
  p_form_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb;
begin
  if not exists (
    select 1
    from public.forms f
    where f.id = p_form_id
      and f.form_kind = 'first_timer'
  ) then
    return;
  end if;

  update public.form_fields ff
  set position = position + 100,
      updated_at = pg_catalog.clock_timestamp()
  where ff.form_id = p_form_id
    and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

  update public.form_fields ff
  set position = case ff.label
        when 'Gender' then 2
        when 'Age group' then 3
        when 'Email' then 4
        when 'Phone' then 5
      end,
      updated_at = pg_catalog.clock_timestamp()
  where ff.form_id = p_form_id
    and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

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
  where ff.form_id = p_form_id;

  update public.form_revisions fr
  set fields_snapshot = v_fields
  where fr.form_id = p_form_id
    and fr.revision = (
      select f.revision from public.forms f where f.id = p_form_id
    );
end;
$$;

create or replace function public.provision_builtin_first_timer_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form_id uuid;
begin
  if new.role in ('owner', 'admin', 'finance') then
    v_form_id := public.ensure_builtin_first_timer_form(
      new.organization_id,
      new.user_id
    );
    perform public.normalize_builtin_first_timer_field_order(v_form_id);
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_builtin_first_timer_field_order(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.provision_builtin_first_timer_form()
  from public, anon, authenticated, service_role;
