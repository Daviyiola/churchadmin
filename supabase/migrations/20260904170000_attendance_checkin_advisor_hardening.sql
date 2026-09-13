-- Follow-up after advisor review: deny policies, trigger-function grants, and FK indexes.

revoke all on function public.close_checkin_windows_on_session_change(),public.repoint_attendance_checkin_merge(),public.validate_attendance_checkin_code(),public.validate_attendance_service() from public,anon,authenticated;

create policy attendance_remembered_devices_no_direct_access on public.attendance_remembered_devices
 for all to anon,authenticated using(false) with check(false);
create policy attendance_remembered_profiles_no_direct_access on public.attendance_remembered_profiles
 for all to anon,authenticated using(false) with check(false);

drop policy if exists categories_admin_insert on public.categories;
drop policy if exists categories_staff_service_insert on public.categories;
create policy categories_authorized_insert on public.categories for insert to authenticated
 with check(created_by=(select auth.uid()) and (public.is_org_admin(org_id) or (public.is_org_data_entry(org_id) and type='services' and status='active')));

create index if not exists attendance_sessions_service_org_idx on public.attendance_sessions(service_category_id,org_id);
create index if not exists attendance_draft_members_session_org_idx on public.attendance_draft_members(session_id,org_id);
create index if not exists attendance_draft_members_member_org_idx on public.attendance_draft_members(member_id,org_id);
create index if not exists attendance_draft_headcounts_session_org_idx on public.attendance_draft_headcounts(session_id,org_id);
create index if not exists attendance_entries_member_idx on public.attendance_entries(member_id) where member_id is not null;
create index if not exists attendance_entries_service_idx on public.attendance_entries(service_category_id);

create index if not exists attendance_checkin_codes_default_service_org_idx on public.attendance_checkin_codes(default_service_category_id,org_id) where default_service_category_id is not null;
create index if not exists attendance_checkin_codes_created_by_idx on public.attendance_checkin_codes(created_by);
create index if not exists attendance_checkin_codes_updated_by_idx on public.attendance_checkin_codes(updated_by);
create index if not exists attendance_checkin_codes_revoked_by_idx on public.attendance_checkin_codes(revoked_by) where revoked_by is not null;
create index if not exists attendance_checkin_windows_code_org_idx on public.attendance_checkin_windows(code_id,org_id);
create index if not exists attendance_checkin_windows_session_org_idx on public.attendance_checkin_windows(session_id,org_id);
create index if not exists attendance_checkin_windows_org_idx on public.attendance_checkin_windows(org_id);
create index if not exists attendance_checkin_windows_created_by_idx on public.attendance_checkin_windows(created_by);
create index if not exists attendance_checkin_windows_closed_by_idx on public.attendance_checkin_windows(closed_by) where closed_by is not null;

create index if not exists attendance_public_checkins_code_org_idx on public.attendance_public_checkins(code_id,org_id);
create index if not exists attendance_public_checkins_window_org_idx on public.attendance_public_checkins(window_id,org_id);
create index if not exists attendance_public_checkins_session_org_idx on public.attendance_public_checkins(session_id,org_id);
create index if not exists attendance_public_checkins_candidate_org_idx on public.attendance_public_checkins(candidate_person_id,org_id) where candidate_person_id is not null;
create index if not exists attendance_public_checkins_resolved_org_idx on public.attendance_public_checkins(resolved_person_id,org_id) where resolved_person_id is not null;
create index if not exists attendance_public_checkins_device_idx on public.attendance_public_checkins(remembered_device_id) where remembered_device_id is not null;
create index if not exists attendance_public_checkins_resolved_by_idx on public.attendance_public_checkins(resolved_by) where resolved_by is not null;
create index if not exists attendance_remembered_profiles_person_org_idx on public.attendance_remembered_profiles(person_id,org_id);
create index if not exists attendance_remembered_profiles_origin_idx on public.attendance_remembered_profiles(originating_checkin_id) where originating_checkin_id is not null;
create index if not exists attendance_remembered_profiles_org_idx on public.attendance_remembered_profiles(org_id);
create index if not exists attendance_checkin_events_checkin_idx on public.attendance_checkin_events(checkin_id) where checkin_id is not null;
create index if not exists attendance_checkin_events_session_idx on public.attendance_checkin_events(session_id) where session_id is not null;
create index if not exists attendance_checkin_events_code_idx on public.attendance_checkin_events(code_id) where code_id is not null;
create index if not exists attendance_checkin_events_actor_idx on public.attendance_checkin_events(actor_id) where actor_id is not null;
