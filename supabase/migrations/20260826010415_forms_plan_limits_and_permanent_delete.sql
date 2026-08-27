update public.plan_entitlements
set form_count_limit = case plan_key
  when 'free' then 2
  when 'basic' then 10
  when 'pro' then 40
  when 'enterprise' then null
end,
updated_at = pg_catalog.now();

drop function if exists public.delete_empty_managed_form(uuid, uuid);

create function public.delete_managed_form(
  p_form_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
begin
  select * into v_form
  from public.forms f
  where f.id = p_form_id
  for update;

  if v_form.id is null then raise exception 'Form not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_form.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;
  if v_form.is_system then raise exception 'Built-in forms cannot be deleted'; end if;
  if v_form.status = 'open' then raise exception 'Close the form before deleting it'; end if;

  -- Submission events cascade. Links from durable member/person audit data are
  -- set to NULL by their foreign keys; deleting a form never reverses updates
  -- that were already applied to people records.
  delete from public.form_submissions s where s.form_id = p_form_id;
  delete from public.forms f where f.id = p_form_id;
end;
$$;

revoke all on function public.delete_managed_form(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.delete_managed_form(uuid, uuid) to service_role;
