-- Finance users may manage ordinary church communications. Member-giving
-- email jobs intentionally continue to use is_org_admin() and are unchanged.
create or replace function public.can_manage_comms(p_org_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = (select auth.uid())
      and uo.role in ('owner', 'admin', 'finance')
  );
$function$;

revoke all on function public.can_manage_comms(uuid) from public;
revoke all on function public.can_manage_comms(uuid) from anon;
grant execute on function public.can_manage_comms(uuid) to authenticated;
grant execute on function public.can_manage_comms(uuid) to service_role;

-- Keep attachment metadata aligned with the same broadcast permission.
drop policy if exists mu_insert on public.message_uploads;
create policy mu_insert
on public.message_uploads
for insert
to authenticated
with check (
  public.can_manage_comms(org_id)
  and uploaded_by = (select auth.uid())
);

drop policy if exists mu_delete on public.message_uploads;
create policy mu_delete
on public.message_uploads
for delete
to authenticated
using (public.can_manage_comms(org_id));
