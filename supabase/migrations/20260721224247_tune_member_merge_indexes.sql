drop index if exists public.attendance_draft_members_session_member_key;
drop index if exists public.attendance_entries_session_member_key;

create index if not exists member_merges_survivor_idx
  on public.member_merges (survivor_member_id);
create index if not exists member_merges_duplicate_idx
  on public.member_merges (duplicate_member_id);
