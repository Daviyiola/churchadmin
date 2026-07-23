-- Finance, admin, and owner may edit/archive member records.
-- Keep visitor data-entry workflows available without allowing ordinary
-- member-role users to update records that have become church members.

drop policy if exists members_update_data_entry on public.members;
drop policy if exists members_update_finance on public.members;
drop policy if exists members_update_data_entry_visitors on public.members;

create policy members_update_finance
  on public.members
  for update
  to authenticated
  using ((select public.is_org_finance(org_id)))
  with check ((select public.is_org_finance(org_id)));

create policy members_update_data_entry_visitors
  on public.members
  for update
  to authenticated
  using (
    membership_stage is distinct from 'member'
    and (select public.is_org_data_entry(org_id))
  )
  with check (
    membership_stage is distinct from 'member'
    and (select public.is_org_data_entry(org_id))
  );

-- members_delete_admin remains unchanged: finance cannot delete members.
