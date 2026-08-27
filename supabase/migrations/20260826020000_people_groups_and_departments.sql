begin;

create table public.community_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  meeting_day smallint check (meeting_day between 0 and 6),
  meeting_time time,
  meeting_location text,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index community_groups_org_name_uidx on public.community_groups(org_id, lower(btrim(name)));
create index community_groups_org_status_idx on public.community_groups(org_id, status, name);

create table public.community_group_members (
  group_id uuid not null,
  member_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null default 'member' check (role in ('member','assistant_leader','leader')),
  status text not null default 'active' check (status in ('active','removed')),
  joined_at date not null default current_date,
  removed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, member_id),
  foreign key (group_id, org_id) references public.community_groups(id, org_id) on delete cascade,
  foreign key (member_id) references public.members(id) on delete restrict
);
create index community_group_members_member_idx on public.community_group_members(org_id, member_id, status);
create index community_group_members_group_idx on public.community_group_members(org_id, group_id, status);

create table public.member_departments (
  member_id uuid not null,
  department_category_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null default 'member' check (role in ('member','assistant_leader','leader')),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active','removed')),
  joined_at date not null default current_date,
  removed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, department_category_id),
  foreign key (member_id) references public.members(id) on delete restrict,
  foreign key (department_category_id) references public.categories(id) on delete restrict
);
create unique index member_departments_one_primary_idx on public.member_departments(member_id) where status='active' and is_primary;
create index member_departments_department_idx on public.member_departments(org_id, department_category_id, status);
create index member_departments_member_idx on public.member_departments(org_id, member_id, status);

create table public.people_membership_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('community_group','worker_department')),
  entity_id uuid not null,
  member_id uuid,
  action text not null,
  role text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index people_membership_events_org_time_idx on public.people_membership_events(org_id, created_at desc);
create index people_membership_events_member_idx on public.people_membership_events(member_id, created_at desc);

create or replace function public.validate_people_membership_target()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member public.members%rowtype; v_category public.categories%rowtype;
begin
  select * into v_member from public.members where id = new.member_id;
  if v_member.id is null or v_member.org_id <> new.org_id or v_member.membership_stage <> 'member' or v_member.status not in ('active','archived') then
    raise exception 'PERSON_TARGET_INVALID';
  end if;
  if tg_table_name = 'member_departments' then
    select * into v_category from public.categories where id = new.department_category_id;
    if v_category.id is null or v_category.org_id <> new.org_id or v_category.type <> 'department' then raise exception 'DEPARTMENT_TARGET_INVALID'; end if;
  end if;
  new.updated_at := now();
  new.removed_at := case when new.status = 'removed' then coalesce(new.removed_at, now()) else null end;
  return new;
end $$;

create trigger community_group_members_validate before insert or update on public.community_group_members for each row execute function public.validate_people_membership_target();
create trigger member_departments_validate before insert or update on public.member_departments for each row execute function public.validate_people_membership_target();

create or replace function public.sync_primary_department_from_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_stage='member' and new.status in ('active','archived') and new.department_category_id is not null
     and (tg_op='INSERT' or new.department_category_id is distinct from old.department_category_id) then
    update public.member_departments set is_primary=false, updated_at=now()
      where member_id=new.id and status='active' and is_primary and department_category_id<>new.department_category_id;
    insert into public.member_departments(member_id,department_category_id,org_id,role,is_primary,status,joined_at,created_by,updated_by)
    values(new.id,new.department_category_id,new.org_id,'member',true,'active',coalesce(new.joined_at,current_date),new.updated_by,new.updated_by)
    on conflict(member_id,department_category_id) do update set is_primary=true,status='active',removed_at=null,updated_by=excluded.updated_by,updated_at=now();
  end if;
  return new;
end $$;
create trigger members_sync_primary_department after insert or update of department_category_id on public.members for each row execute function public.sync_primary_department_from_member();

create table public.member_merge_membership_counts (
  source_member_id uuid primary key,
  target_member_id uuid not null,
  community_groups integer not null default 0,
  worker_departments integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.member_merge_membership_counts enable row level security;
revoke all on public.member_merge_membership_counts from public,anon,authenticated;
grant all on public.member_merge_membership_counts to service_role;

create or replace function public.transfer_people_memberships_on_merge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_groups integer := 0; v_departments integer := 0; v_primary uuid;
begin
  if new.status <> 'merged' or new.merged_into_member_id is null or (old.status='merged' and old.merged_into_member_id is not distinct from new.merged_into_member_id) then return new; end if;
  select count(*) into v_groups from public.community_group_members where member_id=new.id and status='active';
  select count(*) into v_departments from public.member_departments where member_id=new.id and status='active';
  select department_category_id into v_primary from public.member_departments where member_id=new.id and status='active' order by is_primary desc,joined_at,department_category_id limit 1;
  insert into public.community_group_members(group_id,member_id,org_id,role,status,joined_at,created_by,updated_by)
  select group_id,new.merged_into_member_id,org_id,role,status,joined_at,new.merged_by,new.merged_by from public.community_group_members where member_id=new.id
  on conflict(group_id,member_id) do update set role=case when excluded.role='leader' or community_group_members.role='leader' then 'leader' when excluded.role='assistant_leader' or community_group_members.role='assistant_leader' then 'assistant_leader' else 'member' end,status=case when excluded.status='active' or community_group_members.status='active' then 'active' else 'removed' end,joined_at=least(excluded.joined_at,community_group_members.joined_at),removed_at=null,updated_by=new.merged_by,updated_at=now();
  delete from public.community_group_members where member_id=new.id;
  insert into public.member_departments(member_id,department_category_id,org_id,role,is_primary,status,joined_at,created_by,updated_by)
  select new.merged_into_member_id,department_category_id,org_id,role,false,status,joined_at,new.merged_by,new.merged_by from public.member_departments where member_id=new.id
  on conflict(member_id,department_category_id) do update set role=case when excluded.role='leader' or member_departments.role='leader' then 'leader' when excluded.role='assistant_leader' or member_departments.role='assistant_leader' then 'assistant_leader' else 'member' end,status=case when excluded.status='active' or member_departments.status='active' then 'active' else 'removed' end,joined_at=least(excluded.joined_at,member_departments.joined_at),removed_at=null,updated_by=new.merged_by,updated_at=now();
  delete from public.member_departments where member_id=new.id;
  if not exists(select 1 from public.member_departments where member_id=new.merged_into_member_id and status='active' and is_primary) then
    update public.member_departments set is_primary=true where member_id=new.merged_into_member_id and department_category_id=coalesce(v_primary,(select department_category_id from public.member_departments where member_id=new.merged_into_member_id and status='active' order by joined_at,department_category_id limit 1));
  end if;
  update public.members m set department_category_id=(select department_category_id from public.member_departments where member_id=m.id and status='active' order by is_primary desc,joined_at,department_category_id limit 1) where m.id=new.merged_into_member_id;
  insert into public.member_merge_membership_counts(source_member_id,target_member_id,community_groups,worker_departments) values(new.id,new.merged_into_member_id,v_groups,v_departments)
  on conflict(source_member_id) do update set target_member_id=excluded.target_member_id,community_groups=excluded.community_groups,worker_departments=excluded.worker_departments,created_at=now();
  return new;
end $$;
create trigger members_transfer_people_memberships after update of status,merged_into_member_id on public.members for each row execute function public.transfer_people_memberships_on_merge();

create or replace function public.attach_people_counts_to_member_merge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_counts public.member_merge_membership_counts%rowtype;
begin
  select * into v_counts from public.member_merge_membership_counts where source_member_id=new.merged_member_id and target_member_id=new.canonical_member_id;
  if v_counts.source_member_id is not null then
    update public.member_merges set relationship_counts=coalesce(relationship_counts,'{}'::jsonb)||jsonb_build_object('community_groups',v_counts.community_groups,'worker_departments',v_counts.worker_departments) where id=new.id;
    delete from public.member_merge_membership_counts where source_member_id=new.merged_member_id;
  end if;
  return new;
end $$;
create trigger member_merges_attach_people_counts after insert on public.member_merges for each row execute function public.attach_people_counts_to_member_merge();

insert into public.member_departments(member_id,department_category_id,org_id,role,is_primary,status,joined_at,created_by,updated_by)
select id,department_category_id,org_id,'member',true,'active',coalesce(joined_at,current_date),created_by,updated_by
from public.members where membership_stage='member' and status in ('active','archived') and department_category_id is not null
on conflict(member_id,department_category_id) do update set is_primary=true,status='active',removed_at=null;

alter table public.community_groups enable row level security;
alter table public.community_group_members enable row level security;
alter table public.member_departments enable row level security;
alter table public.people_membership_events enable row level security;

create policy community_groups_org_staff on public.community_groups for all to authenticated using ((select public.is_org_finance(org_id))) with check ((select public.is_org_finance(org_id)));
create policy community_group_members_org_staff on public.community_group_members for all to authenticated using ((select public.is_org_finance(org_id))) with check ((select public.is_org_finance(org_id)));
create policy member_departments_org_staff on public.member_departments for all to authenticated using ((select public.is_org_finance(org_id))) with check ((select public.is_org_finance(org_id)));
create policy people_membership_events_org_staff_read on public.people_membership_events for select to authenticated using ((select public.is_org_finance(org_id)));

revoke all on public.community_groups, public.community_group_members, public.member_departments, public.people_membership_events from public, anon;
grant select,insert,update on public.community_groups, public.community_group_members, public.member_departments to authenticated;
grant select on public.people_membership_events to authenticated;
grant all on public.community_groups, public.community_group_members, public.member_departments, public.people_membership_events to service_role;
revoke all on function public.validate_people_membership_target() from public,anon,authenticated;
revoke all on function public.sync_primary_department_from_member() from public,anon,authenticated;
revoke all on function public.transfer_people_memberships_on_merge() from public,anon,authenticated;
revoke all on function public.attach_people_counts_to_member_merge() from public,anon,authenticated;

commit;
