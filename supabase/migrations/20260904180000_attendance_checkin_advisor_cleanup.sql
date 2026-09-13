-- Targeted cleanup for advisor findings introduced by attendance QR check-in.

drop policy if exists attendance_sessions_staff_insert on public.attendance_sessions;
create policy attendance_sessions_staff_insert
on public.attendance_sessions for insert to authenticated
with check (
  public.is_org_data_entry(org_id)
  and created_by = (select auth.uid())
  and status = 'draft'
  and deleted_at is null
);

drop policy if exists attendance_draft_members_staff_insert on public.attendance_draft_members;
create policy attendance_draft_members_staff_insert
on public.attendance_draft_members for insert to authenticated
with check (
  public.is_org_data_entry(org_id)
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.attendance_sessions s
    where s.id = session_id and s.org_id = org_id and s.status = 'draft' and s.deleted_at is null
  )
  and exists (
    select 1 from public.members m
    where m.id = member_id and m.org_id = org_id and m.status <> 'merged'
  )
);

drop policy if exists attendance_draft_headcounts_staff_insert on public.attendance_draft_headcounts;
create policy attendance_draft_headcounts_staff_insert
on public.attendance_draft_headcounts for insert to authenticated
with check (
  public.is_org_data_entry(org_id)
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.attendance_sessions s
    where s.id = session_id and s.org_id = org_id and s.status = 'draft' and s.deleted_at is null
  )
);

create index if not exists attendance_public_checkins_org_idx
  on public.attendance_public_checkins(org_id);
