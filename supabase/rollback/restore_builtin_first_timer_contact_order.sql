update public.form_fields ff
set position = position + 100,
    updated_at = pg_catalog.clock_timestamp()
from public.forms f
where f.id = ff.form_id
  and f.form_kind = 'first_timer'
  and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

update public.form_fields ff
set position = case ff.label
      when 'Email' then 2
      when 'Phone' then 3
      when 'Gender' then 4
      when 'Age group' then 5
    end,
    updated_at = pg_catalog.clock_timestamp()
from public.forms f
where f.id = ff.form_id
  and f.form_kind = 'first_timer'
  and ff.label in ('Email', 'Phone', 'Gender', 'Age group');

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

revoke all on function public.provision_builtin_first_timer_form()
  from public, anon, authenticated, service_role;
drop function if exists public.normalize_builtin_first_timer_field_order(uuid);

-- Existing revision history is preserved. A later edit/status revision will
-- capture the restored field order without rewriting prior snapshots.
