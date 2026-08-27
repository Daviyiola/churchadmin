begin;
grant select,insert,update,delete on public.community_groups, public.community_group_members, public.member_departments to authenticated;
grant select,insert,update,delete on public.people_membership_events to authenticated;
commit;
