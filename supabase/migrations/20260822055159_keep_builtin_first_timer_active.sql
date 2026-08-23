insert into public.form_revisions (
  form_id, org_id, revision, action, title, description,
  status, fields_snapshot, actor_id
)
select
  f.id,
  f.org_id,
  f.revision + 1,
  'opened',
  f.title,
  f.description,
  'open',
  coalesce(fields.snapshot, '[]'::jsonb),
  f.updated_by
from public.forms f
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
  where ff.form_id = f.id
) fields on true
where f.form_kind = 'first_timer'
  and f.status <> 'open';

update public.forms
set status = 'open',
    revision = revision + 1,
    opened_at = coalesce(opened_at, pg_catalog.clock_timestamp()),
    closed_at = null,
    updated_at = pg_catalog.clock_timestamp()
where form_kind = 'first_timer'
  and status <> 'open';

alter table public.forms
  add constraint forms_first_timer_active_check
  check (form_kind <> 'first_timer' or status = 'open');

create or replace function public.force_builtin_first_timer_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.form_kind = 'first_timer' and new.status <> 'open' then
    if tg_op = 'INSERT' then
      new.status := 'open';
      new.opened_at := coalesce(new.opened_at, pg_catalog.clock_timestamp());
      new.closed_at := null;
    else
      raise exception 'The built-in First Timers Form is always active';
    end if;
  end if;
  return new;
end;
$$;

create trigger forms_keep_builtin_first_timer_active
before insert or update of status, form_kind on public.forms
for each row
execute function public.force_builtin_first_timer_active();

create or replace function public.force_builtin_first_timer_revision_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.forms f
    where f.id = new.form_id
      and f.form_kind = 'first_timer'
  ) then
    if new.action = 'created' then
      new.status := 'open';
    elsif new.status <> 'open' then
      raise exception 'The built-in First Timers Form is always active';
    end if;
  end if;
  return new;
end;
$$;

create trigger form_revisions_keep_builtin_first_timer_active
before insert or update of status on public.form_revisions
for each row
execute function public.force_builtin_first_timer_revision_active();

revoke all on function public.force_builtin_first_timer_active()
  from public, anon, authenticated, service_role;
revoke all on function public.force_builtin_first_timer_revision_active()
  from public, anon, authenticated, service_role;
