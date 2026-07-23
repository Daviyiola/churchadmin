-- Use only before the first merge event. Aborts if audit history exists.
begin;
do $$ begin
  if exists(select 1 from public.member_merges) then
    raise exception 'Member merges exist; use disable_member_merging_after_use.sql instead';
  end if;
end $$;
drop function if exists public.preview_member_merge(uuid,uuid);
drop function if exists public.merge_members(uuid,uuid,text[],text,boolean);
do $$ declare v_table text; begin
  foreach v_table in array array['attendance_draft_members','attendance_entries','income_draft_items','income_entries','income_import_rows','intake_tokens','scheduled_followups','visitor_details','followup_emails','report_email_job_recipients'] loop
    execute format('drop trigger if exists reject_merged_member_reference on public.%I',v_table);
  end loop;
end $$;
drop function if exists public.reject_merged_member_reference();
drop index if exists public.attendance_draft_members_session_member_key;
drop index if exists public.attendance_entries_session_member_key;
drop table if exists public.member_merge_audits;
drop table if exists public.member_merges;
alter table public.members drop constraint if exists members_merged_state_check;
alter table public.members drop constraint if exists members_merged_into_member_id_fkey;
drop index if exists public.members_merged_into_idx;
alter table public.members drop column if exists merged_into_member_id;
alter table public.members drop column if exists merged_at;
alter table public.members drop column if exists merged_by;
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check check(status=any(array['active'::text,'archived'::text]));
commit;
