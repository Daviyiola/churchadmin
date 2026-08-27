begin;

revoke all on public.community_groups, public.community_group_members, public.member_departments, public.people_membership_events, public.member_merge_membership_counts from authenticated;
grant select,insert,update on public.community_groups, public.community_group_members, public.member_departments to authenticated;
grant select on public.people_membership_events to authenticated;

create or replace function public.validate_people_membership_target()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member public.members%rowtype; v_category public.categories%rowtype; v_group public.community_groups%rowtype;
begin
  select * into v_member from public.members where id = new.member_id;
  if v_member.id is null or v_member.org_id <> new.org_id or v_member.membership_stage <> 'member' or v_member.status not in ('active','archived') then
    raise exception 'PERSON_TARGET_INVALID';
  end if;
  if tg_table_name = 'member_departments' then
    select * into v_category from public.categories where id = new.department_category_id;
    if v_category.id is null or v_category.org_id <> new.org_id or v_category.type <> 'department' or (new.status='active' and v_category.status<>'active') then raise exception 'DEPARTMENT_TARGET_INVALID'; end if;
  else
    select * into v_group from public.community_groups where id = new.group_id;
    if v_group.id is null or v_group.org_id <> new.org_id or (new.status='active' and v_group.status<>'active') then raise exception 'GROUP_TARGET_INVALID'; end if;
  end if;
  new.updated_at := now();
  new.removed_at := case when new.status = 'removed' then coalesce(new.removed_at, now()) else null end;
  return new;
end $$;
revoke all on function public.validate_people_membership_target() from public,anon,authenticated;
grant execute on function public.validate_people_membership_target() to service_role;

commit;
