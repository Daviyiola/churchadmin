do $$
begin
  if exists (select 1 from public.forms limit 1) then
    raise exception 'Forms exist. Do not use the destructive pre-use rollback.';
  end if;
end
$$;

drop function if exists public.set_managed_form_status(uuid, uuid, text);
drop function if exists public.save_managed_form(uuid, uuid, text, text, jsonb);
drop function if exists public.create_managed_form(uuid, uuid, text, text, text);
drop table if exists public.form_revisions;
drop table if exists public.form_fields;
drop table if exists public.forms;
alter table public.plan_entitlements
  drop column if exists form_count_limit;
