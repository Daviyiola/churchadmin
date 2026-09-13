-- Composite organization-scoped foreign keys added by QR check-in supersede
-- these older single-column keys. Keeping both makes PostgREST relationship
-- embedding ambiguous while providing no additional integrity protection.

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_service_category_id_fkey;

alter table public.attendance_draft_members
  drop constraint if exists attendance_draft_members_session_id_fkey,
  drop constraint if exists attendance_draft_members_member_id_fkey;

alter table public.attendance_draft_headcounts
  drop constraint if exists attendance_draft_headcounts_session_id_fkey;

notify pgrst, 'reload schema';
