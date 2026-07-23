-- Emergency rollback for the published batch-editing feature.
-- This intentionally preserves audit tables, revision metadata, and accepted
-- service/date changes. It only disables new edits. Removing audit data or
-- reversing business edits requires a separately reviewed data migration.

begin;

revoke all on function public.edit_published_income_batch(uuid, uuid, date, text)
  from public, anon, authenticated;
revoke all on function public.edit_published_attendance_session(uuid, uuid, date, text)
  from public, anon, authenticated;

drop function if exists public.edit_published_income_batch(uuid, uuid, date, text);
drop function if exists public.edit_published_attendance_session(uuid, uuid, date, text);

commit;
