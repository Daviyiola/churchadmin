-- Roll back the member-update policy split without changing member data.

begin;

drop policy if exists members_update_finance on public.members;
drop policy if exists members_update_data_entry_visitors on public.members;
drop policy if exists members_update_people_managers on public.members;
drop policy if exists members_update_data_entry on public.members;
drop policy if exists members_update_admin on public.members;

create policy members_update_admin
  on public.members
  for update
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

create policy members_update_data_entry
  on public.members
  for update
  using (public.is_org_data_entry(org_id))
  with check (public.is_org_data_entry(org_id));

commit;
