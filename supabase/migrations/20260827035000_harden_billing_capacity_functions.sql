revoke all on function public.enforce_people_capacity() from public,anon,authenticated;
revoke all on function public.enforce_form_capacity_trigger() from public,anon,authenticated;
revoke all on function public.enforce_management_seat_capacity() from public,anon,authenticated;
revoke all on function public.enforce_invite_seat_capacity() from public,anon,authenticated;
revoke all on function public.protect_last_owner() from public,anon,authenticated;
drop index if exists public.members_org_stage_status_capacity_idx;
