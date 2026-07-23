-- Consolidate overlapping permissive UPDATE policies into one auditable rule.

drop policy if exists members_update_admin on public.members;
drop policy if exists members_update_finance on public.members;
drop policy if exists members_update_data_entry_visitors on public.members;
drop policy if exists members_update_people_managers on public.members;

create policy members_update_people_managers
  on public.members
  for update
  to authenticated
  using (
    (select public.is_org_finance(org_id))
    or (
      membership_stage is distinct from 'member'
      and (select public.is_org_data_entry(org_id))
    )
  )
  with check (
    (select public.is_org_finance(org_id))
    or (
      membership_stage is distinct from 'member'
      and (select public.is_org_data_entry(org_id))
    )
  );
