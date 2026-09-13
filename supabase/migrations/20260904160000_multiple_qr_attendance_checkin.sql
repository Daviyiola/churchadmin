-- Multiple reusable QR attendance check-in and attendance authorization hardening.

alter table public.members add constraint members_id_org_unique unique (id, org_id);
alter table public.categories add constraint categories_id_org_unique unique (id, org_id);

alter table public.attendance_sessions
  add column if not exists unresolved_checkins_at_publish integer not null default 0,
  add column if not exists attendance_completeness text not null default 'complete'
    check (attendance_completeness in ('complete','unresolved_omitted'));

alter table public.attendance_sessions
  add constraint attendance_sessions_service_org_fk
  foreign key (service_category_id, org_id) references public.categories(id, org_id) not valid;
alter table public.attendance_draft_members
  add constraint attendance_draft_members_session_org_fk
  foreign key (session_id, org_id) references public.attendance_sessions(id, org_id) on delete cascade not valid,
  add constraint attendance_draft_members_member_org_fk
  foreign key (member_id, org_id) references public.members(id, org_id) not valid;
alter table public.attendance_draft_headcounts
  add constraint attendance_draft_headcounts_session_org_fk
  foreign key (session_id, org_id) references public.attendance_sessions(id, org_id) on delete cascade not valid;

alter table public.attendance_sessions validate constraint attendance_sessions_service_org_fk;
alter table public.attendance_draft_members validate constraint attendance_draft_members_session_org_fk;
alter table public.attendance_draft_members validate constraint attendance_draft_members_member_org_fk;
alter table public.attendance_draft_headcounts validate constraint attendance_draft_headcounts_session_org_fk;

create table public.attendance_checkin_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_norm text generated always as (lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))) stored,
  default_service_category_id uuid,
  token_version integer not null default 1 check (token_version > 0),
  expires_on date,
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  constraint attendance_checkin_codes_id_org_unique unique(id,org_id),
  constraint attendance_checkin_codes_service_org_fk foreign key(default_service_category_id,org_id)
    references public.categories(id,org_id)
);
create unique index attendance_checkin_codes_active_name_key
  on public.attendance_checkin_codes(org_id,name_norm) where status <> 'revoked';
create index attendance_checkin_codes_org_status_idx on public.attendance_checkin_codes(org_id,status,updated_at desc);

create table public.attendance_checkin_windows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code_id uuid not null,
  session_id uuid not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','open','closed','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  constraint attendance_checkin_windows_time_check check(closes_at > opens_at),
  constraint attendance_checkin_windows_code_org_fk foreign key(code_id,org_id)
    references public.attendance_checkin_codes(id,org_id),
  constraint attendance_checkin_windows_session_org_fk foreign key(session_id,org_id)
    references public.attendance_sessions(id,org_id) on delete cascade,
  constraint attendance_checkin_windows_id_org_unique unique(id,org_id)
);
create unique index attendance_checkin_windows_one_live_per_code
  on public.attendance_checkin_windows(code_id) where status in ('scheduled','open');
create index attendance_checkin_windows_session_idx on public.attendance_checkin_windows(session_id,status,opens_at);

create table public.attendance_remembered_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check(char_length(token_hash)=64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create table public.attendance_public_checkins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code_id uuid not null,
  window_id uuid not null,
  session_id uuid not null,
  request_id uuid not null,
  submitted_first_name text,
  submitted_last_name text,
  submitted_phone text,
  submitted_email text,
  submitted_name_hash text not null,
  state text not null check(state in ('awaiting_confirmation','unresolved','linked','duplicate','converted_headcount','excluded')),
  candidate_person_id uuid,
  resolved_person_id uuid,
  remembered_device_id uuid references public.attendance_remembered_devices(id) on delete set null,
  remember_requested boolean not null default false,
  resolution_reason text,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  redacted_at timestamptz,
  constraint attendance_public_checkins_request_key unique(code_id,request_id),
  constraint attendance_public_checkins_code_org_fk foreign key(code_id,org_id)
    references public.attendance_checkin_codes(id,org_id),
  constraint attendance_public_checkins_window_org_fk foreign key(window_id,org_id)
    references public.attendance_checkin_windows(id,org_id),
  constraint attendance_public_checkins_session_org_fk foreign key(session_id,org_id)
    references public.attendance_sessions(id,org_id),
  constraint attendance_public_checkins_candidate_org_fk foreign key(candidate_person_id,org_id)
    references public.members(id,org_id),
  constraint attendance_public_checkins_resolved_org_fk foreign key(resolved_person_id,org_id)
    references public.members(id,org_id)
);
create index attendance_public_checkins_session_state_idx on public.attendance_public_checkins(session_id,state,created_at);
create index attendance_public_checkins_redaction_idx on public.attendance_public_checkins(resolved_at)
  where redacted_at is null and state in ('linked','duplicate','converted_headcount','excluded');

create table public.attendance_remembered_profiles (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_remembered_devices(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null,
  originating_checkin_id uuid references public.attendance_public_checkins(id) on delete set null,
  label text not null check(char_length(label) between 1 and 160),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint attendance_remembered_profiles_person_org_fk foreign key(person_id,org_id)
    references public.members(id,org_id)
);
create unique index attendance_remembered_profiles_active_key
  on public.attendance_remembered_profiles(device_id,org_id,person_id) where revoked_at is null;
create index attendance_remembered_profiles_device_org_idx on public.attendance_remembered_profiles(device_id,org_id) where revoked_at is null;

create table public.attendance_checkin_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  checkin_id uuid references public.attendance_public_checkins(id) on delete set null,
  session_id uuid references public.attendance_sessions(id) on delete set null,
  code_id uuid references public.attendance_checkin_codes(id) on delete set null,
  event_type text not null,
  actor_id uuid references auth.users(id),
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index attendance_checkin_events_org_created_idx on public.attendance_checkin_events(org_id,created_at desc);

alter table public.attendance_checkin_codes enable row level security;
alter table public.attendance_checkin_windows enable row level security;
alter table public.attendance_public_checkins enable row level security;
alter table public.attendance_remembered_devices enable row level security;
alter table public.attendance_remembered_profiles enable row level security;
alter table public.attendance_checkin_events enable row level security;

create policy attendance_checkin_codes_staff_read on public.attendance_checkin_codes
  for select to authenticated using(public.is_org_data_entry(org_id));
create policy attendance_checkin_windows_staff_read on public.attendance_checkin_windows
  for select to authenticated using(public.is_org_data_entry(org_id));
create policy attendance_public_checkins_staff_read on public.attendance_public_checkins
  for select to authenticated using(public.is_org_data_entry(org_id));
create policy attendance_checkin_events_staff_read on public.attendance_checkin_events
  for select to authenticated using(public.is_org_data_entry(org_id));

revoke all on public.attendance_checkin_codes, public.attendance_checkin_windows,
 public.attendance_public_checkins, public.attendance_remembered_devices,
 public.attendance_remembered_profiles, public.attendance_checkin_events from public,anon,authenticated;
grant select on public.attendance_checkin_codes,public.attendance_checkin_windows,
 public.attendance_public_checkins,public.attendance_checkin_events to authenticated;

create or replace function public.validate_attendance_service()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.categories c where c.id=new.service_category_id and c.org_id=new.org_id and c.type='services' and c.status='active') then
    raise exception 'Select an active service from this organization.';
  end if;
  return new;
end $$;
create trigger attendance_sessions_validate_service before insert or update of service_category_id,org_id
 on public.attendance_sessions for each row execute function public.validate_attendance_service();

create or replace function public.create_attendance_checkin_code(
 p_org_id uuid,p_name text,p_default_service_category_id uuid default null,p_expires_on date default null)
returns public.attendance_checkin_codes language plpgsql security definer set search_path='' as $$
declare v_row public.attendance_checkin_codes; v_tz text;
begin
 if auth.uid() is null or not public.is_org_data_entry(p_org_id) then raise exception 'Forbidden'; end if;
 perform 1 from public.organizations where id=p_org_id for update;
 select timezone_name into v_tz from public.organization_settings where organization_id=p_org_id and timezone_confirmed;
 if v_tz is null then raise exception 'Confirm the organization timezone before creating a QR code.'; end if;
 if (select count(*) from public.attendance_checkin_codes where org_id=p_org_id and status<>'revoked')>=5 then
   raise exception 'This organization already has five active QR codes.';
 end if;
 if p_expires_on is not null and p_expires_on < (now() at time zone v_tz)::date then raise exception 'Expiration date cannot be in the past.'; end if;
 if p_default_service_category_id is not null and not exists(select 1 from public.categories where id=p_default_service_category_id and org_id=p_org_id and type='services' and status='active') then raise exception 'Invalid service.'; end if;
 insert into public.attendance_checkin_codes(org_id,name,default_service_category_id,expires_on,created_by,updated_by)
 values(p_org_id,btrim(p_name),p_default_service_category_id,p_expires_on,auth.uid(),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create or replace function public.open_attendance_checkin_window(
 p_code_id uuid,p_session_id uuid,p_opens_at timestamptz,p_closes_at timestamptz)
returns public.attendance_checkin_windows language plpgsql security definer set search_path='' as $$
declare v_code public.attendance_checkin_codes; v_session public.attendance_sessions; v_row public.attendance_checkin_windows; v_tz text;
begin
 select * into v_code from public.attendance_checkin_codes where id=p_code_id for update;
 if v_code.id is null or auth.uid() is null or not public.is_org_data_entry(v_code.org_id) then raise exception 'Forbidden'; end if;
 if v_code.status='revoked' then raise exception 'This QR code is revoked.'; end if;
 select * into v_session from public.attendance_sessions where id=p_session_id and org_id=v_code.org_id for update;
 if v_session.id is null or v_session.status<>'draft' or v_session.deleted_at is not null then raise exception 'Select a current attendance draft.'; end if;
 if p_closes_at<=p_opens_at then raise exception 'Closing time must be after opening time.'; end if;
 select timezone_name into v_tz from public.organization_settings where organization_id=v_code.org_id and timezone_confirmed;
 if v_tz is null then raise exception 'Confirm the organization timezone before opening check-in.'; end if;
 if v_code.expires_on is not null and p_closes_at > ((v_code.expires_on+1)::timestamp at time zone v_tz) then raise exception 'The QR code expires before this window closes.'; end if;
 update public.attendance_checkin_windows set status='cancelled',closed_at=now(),closed_by=auth.uid(),updated_at=now()
 where code_id=p_code_id and status in ('scheduled','open');
 insert into public.attendance_checkin_windows(org_id,code_id,session_id,opens_at,closes_at,status,created_by)
 values(v_code.org_id,p_code_id,p_session_id,p_opens_at,p_closes_at,case when p_opens_at<=now() then 'open' else 'scheduled' end,auth.uid()) returning * into v_row;
 return v_row;
end $$;

create or replace function public.resolve_attendance_public_checkin(
 p_checkin_id uuid,p_action text,p_person_id uuid default null,p_gender text default null,p_age_group text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.attendance_public_checkins; s public.attendance_sessions; m public.members; v_segment text; v_row_id uuid;
begin
 select * into v from public.attendance_public_checkins where id=p_checkin_id for update;
 if v.id is null or auth.uid() is null or not public.is_org_data_entry(v.org_id) then raise exception 'Forbidden'; end if;
 select * into s from public.attendance_sessions where id=v.session_id for update;
 if s.status<>'draft' and p_action<>'exclude' then raise exception 'Revert this session to draft before changing attendance.'; end if;
 if v.state not in ('unresolved','awaiting_confirmation') then raise exception 'This check-in has already been resolved.'; end if;
 if p_action='link' then
   select * into m from public.members where id=p_person_id and org_id=v.org_id and status='active';
   if m.id is null then raise exception 'Select an active person from this organization.'; end if;
   insert into public.attendance_draft_members(org_id,session_id,member_id,created_by)
   values(v.org_id,v.session_id,m.id,auth.uid()) on conflict(session_id,member_id) do nothing returning id into v_row_id;
   update public.attendance_public_checkins set state=case when v_row_id is null then 'duplicate' else 'linked' end,resolved_person_id=m.id,resolved_by=auth.uid(),resolved_at=now() where id=v.id;
 elsif p_action='headcount' then
   if p_gender not in ('male','female') or p_age_group not in ('1-12','13-17','18-35','36+','unknown') then raise exception 'Gender and age group are required.'; end if;
   v_segment:=case when p_age_group='unknown' then 'unknown' when p_age_group in ('1-12','13-17') then case when p_gender='male' then 'boys' else 'girls' end else case when p_gender='male' then 'men' else 'women' end end;
   insert into public.attendance_draft_headcounts(org_id,session_id,gender,age_group,segment,count,note,created_by)
   values(v.org_id,v.session_id,p_gender,p_age_group,v_segment,1,'Converted from unresolved QR check-in',auth.uid());
   update public.attendance_public_checkins set state='converted_headcount',resolved_by=auth.uid(),resolved_at=now() where id=v.id;
 elsif p_action='exclude' then
   if nullif(btrim(p_reason),'') is null then raise exception 'A reason is required.'; end if;
   update public.attendance_public_checkins set state='excluded',resolution_reason=btrim(p_reason),resolved_by=auth.uid(),resolved_at=now() where id=v.id;
 else raise exception 'Unsupported resolution action.'; end if;
 insert into public.attendance_checkin_events(org_id,checkin_id,session_id,code_id,event_type,actor_id,safe_metadata)
 values(v.org_id,v.id,v.session_id,v.code_id,'staff_'||p_action,auth.uid(),jsonb_build_object('result',(select state from public.attendance_public_checkins where id=v.id)));
 return (select jsonb_build_object('id',id,'state',state,'resolved_person_id',resolved_person_id) from public.attendance_public_checkins where id=v.id);
end $$;

create or replace function public.create_person_from_attendance_checkin(
 p_checkin_id uuid,p_membership_stage text,p_gender text,p_age_group text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.attendance_public_checkins; s public.attendance_sessions; person_id uuid; v_segment text;
begin
 select * into x from public.attendance_public_checkins where id=p_checkin_id for update;
 if x.id is null or auth.uid() is null or not public.is_org_data_entry(x.org_id) then raise exception 'Forbidden'; end if;
 select * into s from public.attendance_sessions where id=x.session_id for update;
 if s.status<>'draft' then raise exception 'Revert this session to draft before changing attendance.'; end if;
 if x.state not in ('unresolved','awaiting_confirmation') then raise exception 'This check-in has already been resolved.'; end if;
 if p_membership_stage not in ('member','visitor') then raise exception 'Choose member or first-timer.'; end if;
 if p_gender not in ('male','female') or p_age_group not in ('1-12','13-17','18-35','36+') then raise exception 'Gender and age group are required.'; end if;
 v_segment:=case when p_age_group in ('1-12','13-17') then case when p_gender='male' then 'boys' else 'girls' end else case when p_gender='male' then 'men' else 'women' end end;
 insert into public.members(org_id,first_name,last_name,email,phone,status,gender,age_group,segment,membership_stage,profile_complete,created_by,updated_by)
 values(x.org_id,x.submitted_first_name,x.submitted_last_name,x.submitted_email,x.submitted_phone,'active',p_gender,p_age_group,v_segment,p_membership_stage,false,auth.uid(),auth.uid()) returning id into person_id;
 if p_membership_stage='visitor' then
   insert into public.visitor_details(member_id,first_visit_at,follow_up_status) values(person_id,s.session_date,'new');
 end if;
 insert into public.attendance_draft_members(org_id,session_id,member_id,created_by) values(x.org_id,x.session_id,person_id,auth.uid());
 update public.attendance_public_checkins set state='linked',resolved_person_id=person_id,resolved_by=auth.uid(),resolved_at=now() where id=x.id;
 insert into public.attendance_checkin_events(org_id,checkin_id,session_id,code_id,event_type,actor_id,safe_metadata)
 values(x.org_id,x.id,x.session_id,x.code_id,'staff_created_person',auth.uid(),jsonb_build_object('membership_stage',p_membership_stage));
 return jsonb_build_object('state','linked','person_id',person_id,'membership_stage',p_membership_stage);
end $$;

create or replace function public.record_public_attendance_checkin(
 p_code_id uuid,p_window_id uuid,p_request_id uuid,p_first_name text,p_last_name text,
 p_phone text,p_email text,p_name_hash text,p_state text,p_candidate_person_id uuid,
 p_remember_requested boolean,p_device_token_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.attendance_checkin_codes; w public.attendance_checkin_windows; s public.attendance_sessions; d_id uuid; x public.attendance_public_checkins;
begin
 if auth.role()<>'service_role' then raise exception 'Forbidden'; end if;
 select * into c from public.attendance_checkin_codes where id=p_code_id for share;
 select * into w from public.attendance_checkin_windows where id=p_window_id and code_id=p_code_id for update;
 if c.id is null or c.status='revoked' or w.id is null or w.status not in ('scheduled','open') or now()<w.opens_at or now()>=w.closes_at then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
 select * into s from public.attendance_sessions where id=w.session_id and org_id=w.org_id for update;
 if s.id is null or s.status<>'draft' or s.deleted_at is not null then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
 if p_state not in ('awaiting_confirmation','unresolved') then raise exception 'Invalid match state'; end if;
 if p_candidate_person_id is not null and not exists(select 1 from public.members m where m.id=p_candidate_person_id and m.org_id=c.org_id and m.status='active' and m.membership_stage='member') then raise exception 'Invalid candidate'; end if;
 if p_device_token_hash is not null then
   insert into public.attendance_remembered_devices(token_hash) values(p_device_token_hash)
   on conflict(token_hash) do update set last_used_at=now() where public.attendance_remembered_devices.revoked_at is null
   returning id into d_id;
 end if;
 insert into public.attendance_public_checkins(org_id,code_id,window_id,session_id,request_id,submitted_first_name,submitted_last_name,submitted_phone,submitted_email,submitted_name_hash,state,candidate_person_id,remember_requested,remembered_device_id)
 values(c.org_id,c.id,w.id,s.id,p_request_id,left(btrim(p_first_name),100),left(btrim(p_last_name),100),nullif(left(btrim(p_phone),80),''),nullif(lower(left(btrim(p_email),254)),''),p_name_hash,p_state,p_candidate_person_id,coalesce(p_remember_requested,false),d_id)
 on conflict(code_id,request_id) do update set request_id=excluded.request_id returning * into x;
 insert into public.attendance_checkin_events(org_id,checkin_id,session_id,code_id,event_type,safe_metadata)
 values(c.org_id,x.id,s.id,c.id,case when p_state='awaiting_confirmation' then 'exact_match_candidate' else 'unresolved_submitted' end,jsonb_build_object('remember_requested',coalesce(p_remember_requested,false)));
 return jsonb_build_object('checkin_id',x.id,'state',x.state);
end $$;

create or replace function public.confirm_public_attendance_checkin(p_checkin_id uuid,p_device_token_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.attendance_public_checkins; s public.attendance_sessions; m public.members; d_id uuid; row_id uuid; final_state text;
begin
 if auth.role()<>'service_role' then raise exception 'Forbidden'; end if;
 select * into x from public.attendance_public_checkins where id=p_checkin_id for update;
 if x.id is null or x.state<>'awaiting_confirmation' or x.candidate_person_id is null then raise exception 'CHECKIN_CONFIRMATION_INVALID'; end if;
 select * into s from public.attendance_sessions where id=x.session_id for update;
 if s.status<>'draft' or s.deleted_at is not null then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
 select * into m from public.members where id=x.candidate_person_id and org_id=x.org_id and status='active' and membership_stage='member';
 if m.id is null then raise exception 'CHECKIN_CONFIRMATION_INVALID'; end if;
 insert into public.attendance_draft_members(org_id,session_id,member_id,created_by)
 values(x.org_id,x.session_id,m.id,coalesce(s.created_by,m.created_by)) on conflict(session_id,member_id) do nothing returning id into row_id;
 final_state:=case when row_id is null then 'duplicate' else 'linked' end;
 if x.remember_requested and p_device_token_hash is not null then
   select id into d_id from public.attendance_remembered_devices where token_hash=p_device_token_hash and revoked_at is null;
   if d_id is not null then
     insert into public.attendance_remembered_profiles(device_id,org_id,person_id,originating_checkin_id,label)
     values(d_id,x.org_id,m.id,x.id,btrim(m.first_name||' '||coalesce(m.last_name,''))) on conflict do nothing;
   end if;
 end if;
 update public.attendance_public_checkins set state=final_state,resolved_person_id=m.id,resolved_at=now() where id=x.id;
 insert into public.attendance_checkin_events(org_id,checkin_id,session_id,code_id,event_type,safe_metadata)
 values(x.org_id,x.id,x.session_id,x.code_id,'attendee_confirmed',jsonb_build_object('duplicate',row_id is null));
 return jsonb_build_object('state',final_state,'display_name',btrim(m.first_name||' '||coalesce(m.last_name,'')));
end $$;

create or replace function public.record_remembered_attendance_checkin(
 p_code_id uuid,p_window_id uuid,p_request_id uuid,p_profile_id uuid,p_device_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.attendance_remembered_profiles; d public.attendance_remembered_devices; w public.attendance_checkin_windows; s public.attendance_sessions; m public.members; x_id uuid; row_id uuid; final_state text;
begin
 if auth.role()<>'service_role' then raise exception 'Forbidden'; end if;
 select * into d from public.attendance_remembered_devices where token_hash=p_device_token_hash and revoked_at is null for update;
 select * into p from public.attendance_remembered_profiles where id=p_profile_id and device_id=d.id and revoked_at is null;
 select * into w from public.attendance_checkin_windows where id=p_window_id and code_id=p_code_id and status in ('scheduled','open') and now()>=opens_at and now()<closes_at for update;
 select * into s from public.attendance_sessions where id=w.session_id and org_id=w.org_id for update;
 select * into m from public.members where id=p.person_id and org_id=w.org_id and status='active' and membership_stage='member';
 if d.id is null or p.id is null or w.id is null or s.id is null or s.status<>'draft' or m.id is null then raise exception 'CHECKIN_PROFILE_INVALID'; end if;
 insert into public.attendance_draft_members(org_id,session_id,member_id,created_by) values(w.org_id,s.id,m.id,coalesce(s.created_by,m.created_by)) on conflict(session_id,member_id) do nothing returning id into row_id;
 final_state:=case when row_id is null then 'duplicate' else 'linked' end;
 insert into public.attendance_public_checkins(org_id,code_id,window_id,session_id,request_id,submitted_name_hash,state,resolved_person_id,remembered_device_id,resolved_at)
 values(w.org_id,p_code_id,w.id,s.id,p_request_id,encode(extensions.digest(lower(m.first_name||' '||coalesce(m.last_name,'')),'sha256'),'hex'),final_state,m.id,d.id,now())
 on conflict(code_id,request_id) do update set request_id=excluded.request_id returning id into x_id;
 update public.attendance_remembered_profiles set last_used_at=now(),label=btrim(m.first_name||' '||coalesce(m.last_name,'')) where id=p.id;
 update public.attendance_remembered_devices set last_used_at=now() where id=d.id;
 return jsonb_build_object('state',final_state,'display_name',btrim(m.first_name||' '||coalesce(m.last_name,'')));
end $$;

create or replace function public.forget_attendance_profile(p_device_token_hash text,p_profile_id uuid default null,p_org_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare d_id uuid; n integer;
begin
 if auth.role()<>'service_role' then raise exception 'Forbidden'; end if;
 select id into d_id from public.attendance_remembered_devices where token_hash=p_device_token_hash and revoked_at is null;
 if d_id is null then return 0; end if;
 update public.attendance_remembered_profiles set revoked_at=now()
 where device_id=d_id and revoked_at is null and (p_profile_id is null or id=p_profile_id) and (p_org_id is null or org_id=p_org_id);
 get diagnostics n=row_count;
 if p_profile_id is null and p_org_id is null then update public.attendance_remembered_devices set revoked_at=now(),revoked_reason='attendee_forget_all' where id=d_id; end if;
 return n;
end $$;

drop function public.publish_attendance_session(uuid);
create function public.publish_attendance_session(p_session_id uuid,p_acknowledge_unresolved boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.attendance_sessions; v_members boolean; v_heads boolean; v_unresolved integer; v_age text;
begin
 select * into s from public.attendance_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Attendance session not found.'; end if;
 if auth.uid() is null or not public.is_org_data_entry(s.org_id) then raise exception 'Only authorized organization users can publish.'; end if;
 if s.status<>'draft' or s.deleted_at is not null then raise exception 'Session is not an active draft.'; end if;
 if not exists(select 1 from public.categories c where c.id=s.service_category_id and c.org_id=s.org_id and c.type='services' and c.status='active') then raise exception 'The selected service is unavailable.'; end if;
 if exists(select 1 from public.attendance_draft_members d left join public.members m on m.id=d.member_id and m.org_id=d.org_id where d.session_id=s.id and (m.id is null or m.status='merged')) then raise exception 'The draft contains an invalid or merged member.'; end if;
 select exists(select 1 from public.attendance_draft_members where session_id=s.id),exists(select 1 from public.attendance_draft_headcounts where session_id=s.id) into v_members,v_heads;
 if not v_members and not v_heads then raise exception 'Add known attendance before publishing.'; end if;
 select count(*) into v_unresolved from public.attendance_public_checkins where session_id=s.id and state in ('awaiting_confirmation','unresolved');
 if v_unresolved>0 and not coalesce(p_acknowledge_unresolved,false) then raise exception 'Unresolved QR check-ins must be acknowledged before publishing.'; end if;
 delete from public.attendance_entries where session_id=s.id;
 insert into public.attendance_entries(org_id,session_id,service_category_id,session_date,entry_source,member_id,gender,age_group,segment,count,note,published_by,published_at)
 select s.org_id,d.session_id,s.service_category_id,s.session_date,'member',d.member_id,m.gender,
  case when m.dob is null then m.age_group when extract(year from age(s.session_date,m.dob)) between 0 and 12 then '1-12' when extract(year from age(s.session_date,m.dob)) between 13 and 17 then '13-17' when extract(year from age(s.session_date,m.dob)) between 18 and 35 then '18-35' else '36+' end,
  public.compute_segment(m.gender,case when m.dob is null then m.age_group when extract(year from age(s.session_date,m.dob)) between 0 and 12 then '1-12' when extract(year from age(s.session_date,m.dob)) between 13 and 17 then '13-17' when extract(year from age(s.session_date,m.dob)) between 18 and 35 then '18-35' else '36+' end),1,d.note,auth.uid(),now()
 from public.attendance_draft_members d join public.members m on m.id=d.member_id and m.org_id=d.org_id where d.session_id=s.id;
 insert into public.attendance_entries(org_id,session_id,service_category_id,session_date,entry_source,member_id,gender,age_group,segment,count,note,published_by,published_at)
 select s.org_id,h.session_id,s.service_category_id,s.session_date,'headcount',null,h.gender,h.age_group,public.compute_segment(h.gender,h.age_group),h.count,h.note,auth.uid(),now()
 from public.attendance_draft_headcounts h where h.session_id=s.id;
 update public.attendance_sessions set status='published',published_by=auth.uid(),published_at=now(),first_published_at=coalesce(first_published_at,now()),
  revision=case when first_published_at is null then 0 else revision end,
  unresolved_checkins_at_publish=v_unresolved,attendance_completeness=case when v_unresolved>0 then 'unresolved_omitted' else 'complete' end where id=s.id;
 update public.attendance_checkin_windows set status='closed',closed_by=auth.uid(),closed_at=now(),updated_at=now() where session_id=s.id and status in ('scheduled','open');
 if v_unresolved>0 then insert into public.attendance_checkin_events(org_id,session_id,event_type,actor_id,safe_metadata) values(s.org_id,s.id,'published_with_unresolved',auth.uid(),jsonb_build_object('unresolved_count',v_unresolved)); end if;
end $$;

create or replace function public.repoint_attendance_checkin_merge()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='merged' and new.merged_into_member_id is not null and (old.status is distinct from new.status or old.merged_into_member_id is distinct from new.merged_into_member_id) then
   update public.attendance_public_checkins set candidate_person_id=new.merged_into_member_id where candidate_person_id=new.id;
   update public.attendance_public_checkins set resolved_person_id=new.merged_into_member_id where resolved_person_id=new.id;
   update public.attendance_remembered_profiles p set revoked_at=now() where p.person_id=new.id and exists(select 1 from public.attendance_remembered_profiles x where x.device_id=p.device_id and x.org_id=p.org_id and x.person_id=new.merged_into_member_id and x.revoked_at is null);
   update public.attendance_remembered_profiles set person_id=new.merged_into_member_id,label=btrim((select first_name||' '||coalesce(last_name,'') from public.members where id=new.merged_into_member_id)) where person_id=new.id and revoked_at is null;
 end if;
 return new;
end $$;
create trigger repoint_attendance_checkin_merge after update of status,merged_into_member_id on public.members
 for each row execute function public.repoint_attendance_checkin_merge();

create or replace function public.validate_attendance_checkin_code()
returns trigger language plpgsql set search_path='' as $$
declare tz text;
begin
 select timezone_name into tz from public.organization_settings where organization_id=new.org_id and timezone_confirmed;
 if tz is null then raise exception 'Confirm the organization timezone before configuring QR check-in.'; end if;
 if new.default_service_category_id is not null and not exists(select 1 from public.categories c where c.id=new.default_service_category_id and c.org_id=new.org_id and c.type='services' and c.status='active') then raise exception 'Select an active service from this organization.'; end if;
 if new.expires_on is not null and new.expires_on < (now() at time zone tz)::date then raise exception 'Expiration date cannot be in the past.'; end if;
 if new.expires_on is not null and exists(select 1 from public.attendance_checkin_windows w where w.code_id=new.id and w.status in ('scheduled','open') and w.closes_at>((new.expires_on+1)::timestamp at time zone tz)) then raise exception 'Expiration cannot be earlier than the current window closing time.'; end if;
 return new;
end $$;
create trigger attendance_checkin_codes_validate before insert or update of org_id,default_service_category_id,expires_on on public.attendance_checkin_codes for each row execute function public.validate_attendance_checkin_code();

create or replace function public.close_checkin_windows_on_session_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'draft' or old.status is distinct from new.status then
  update public.attendance_checkin_windows set status='closed',closed_at=coalesce(closed_at,now()),updated_at=now() where session_id=new.id and status in ('scheduled','open');
 end if;
 return new;
end $$;
create trigger attendance_sessions_close_checkin_windows after update of status on public.attendance_sessions for each row execute function public.close_checkin_windows_on_session_change();

create or replace function public.redact_terminal_attendance_checkins()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Forbidden'; end if;
 update public.attendance_public_checkins set submitted_first_name=null,submitted_last_name=null,submitted_phone=null,submitted_email=null,redacted_at=now()
 where redacted_at is null and state in ('linked','duplicate','converted_headcount','excluded') and resolved_at < now()-interval '1 year';
 get diagnostics n=row_count; return n;
end $$;

select cron.schedule('attendance-checkin-redaction','17 3 * * *',$$select public.redact_terminal_attendance_checkins();$$);

revoke all on function public.create_attendance_checkin_code(uuid,text,uuid,date),public.open_attendance_checkin_window(uuid,uuid,timestamptz,timestamptz),public.resolve_attendance_public_checkin(uuid,text,uuid,text,text,text),public.publish_attendance_session(uuid,boolean),public.redact_terminal_attendance_checkins() from public,anon;
grant execute on function public.create_attendance_checkin_code(uuid,text,uuid,date),public.open_attendance_checkin_window(uuid,uuid,timestamptz,timestamptz),public.resolve_attendance_public_checkin(uuid,text,uuid,text,text,text),public.publish_attendance_session(uuid,boolean) to authenticated;
grant execute on function public.create_person_from_attendance_checkin(uuid,text,text,text) to authenticated;
revoke all on function public.create_person_from_attendance_checkin(uuid,text,text,text) from public,anon;
revoke all on function public.redact_terminal_attendance_checkins() from authenticated;
revoke all on function public.record_public_attendance_checkin(uuid,uuid,uuid,text,text,text,text,text,text,uuid,boolean,text),public.confirm_public_attendance_checkin(uuid,text),public.record_remembered_attendance_checkin(uuid,uuid,uuid,uuid,text),public.forget_attendance_profile(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_public_attendance_checkin(uuid,uuid,uuid,text,text,text,text,text,text,uuid,boolean,text),public.confirm_public_attendance_checkin(uuid,text),public.record_remembered_attendance_checkin(uuid,uuid,uuid,uuid,text),public.forget_attendance_profile(text,uuid,uuid) to service_role;

-- Consolidate legacy permissive policies and make published entries immutable.
drop policy if exists att_sessions_select_org on public.attendance_sessions;
drop policy if exists att_sessions_update_data_entry on public.attendance_sessions;
drop policy if exists att_sessions_write_data_entry on public.attendance_sessions;
drop policy if exists attendance_sessions_delete_org_draft on public.attendance_sessions;
drop policy if exists attendance_sessions_insert_org on public.attendance_sessions;
drop policy if exists attendance_sessions_select_org on public.attendance_sessions;
drop policy if exists attendance_sessions_update_org_draft on public.attendance_sessions;
create policy attendance_sessions_org_read on public.attendance_sessions for select to authenticated using(public.is_org_member(org_id) and (deleted_at is null or public.is_org_admin(org_id)));
create policy attendance_sessions_staff_insert on public.attendance_sessions for insert to authenticated with check(public.is_org_data_entry(org_id) and created_by=auth.uid() and status='draft' and deleted_at is null);
create policy attendance_sessions_staff_update_draft on public.attendance_sessions for update to authenticated using(public.is_org_data_entry(org_id) and status='draft' and deleted_at is null) with check(public.is_org_data_entry(org_id) and status='draft' and deleted_at is null);
create policy attendance_sessions_staff_delete_draft on public.attendance_sessions for delete to authenticated using(public.is_org_data_entry(org_id) and status='draft' and deleted_at is null);

drop policy if exists attendance_draft_members_delete_org_if_draft on public.attendance_draft_members;
drop policy if exists attendance_draft_members_insert_org on public.attendance_draft_members;
drop policy if exists attendance_draft_members_select_org on public.attendance_draft_members;
drop policy if exists attendance_draft_members_update_org_if_draft on public.attendance_draft_members;
create policy attendance_draft_members_org_read on public.attendance_draft_members for select to authenticated using(public.is_org_member(org_id));
create policy attendance_draft_members_staff_insert on public.attendance_draft_members for insert to authenticated with check(public.is_org_data_entry(org_id) and created_by=auth.uid() and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null) and exists(select 1 from public.members m where m.id=member_id and m.org_id=org_id and m.status<>'merged'));
create policy attendance_draft_members_staff_update on public.attendance_draft_members for update to authenticated using(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null)) with check(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null));
create policy attendance_draft_members_staff_delete on public.attendance_draft_members for delete to authenticated using(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null));

drop policy if exists attendance_draft_headcounts_delete_org_if_draft on public.attendance_draft_headcounts;
drop policy if exists attendance_draft_headcounts_insert_org on public.attendance_draft_headcounts;
drop policy if exists attendance_draft_headcounts_select_org on public.attendance_draft_headcounts;
drop policy if exists attendance_draft_headcounts_update_org_if_draft on public.attendance_draft_headcounts;
create policy attendance_draft_headcounts_org_read on public.attendance_draft_headcounts for select to authenticated using(public.is_org_member(org_id));
create policy attendance_draft_headcounts_staff_insert on public.attendance_draft_headcounts for insert to authenticated with check(public.is_org_data_entry(org_id) and created_by=auth.uid() and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null));
create policy attendance_draft_headcounts_staff_update on public.attendance_draft_headcounts for update to authenticated using(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null)) with check(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null));
create policy attendance_draft_headcounts_staff_delete on public.attendance_draft_headcounts for delete to authenticated using(public.is_org_data_entry(org_id) and exists(select 1 from public.attendance_sessions s where s.id=session_id and s.org_id=org_id and s.status='draft' and s.deleted_at is null));

drop policy if exists att_entries_delete_admin on public.attendance_entries;
drop policy if exists att_entries_select_org on public.attendance_entries;
drop policy if exists att_entries_update_data_entry on public.attendance_entries;
drop policy if exists att_entries_write_data_entry on public.attendance_entries;
drop policy if exists attendance_entries_select_org on public.attendance_entries;
create policy attendance_entries_org_read on public.attendance_entries for select to authenticated using(public.is_org_member(org_id));

drop policy if exists categories_insert_org on public.categories;
drop policy if exists categories_write_admin on public.categories;
create policy categories_admin_insert on public.categories for insert to authenticated with check(public.is_org_admin(org_id) and created_by=auth.uid());
create policy categories_staff_service_insert on public.categories for insert to authenticated with check(public.is_org_data_entry(org_id) and type='services' and status='active' and created_by=auth.uid());

revoke all on public.attendance_sessions,public.attendance_draft_members,public.attendance_draft_headcounts,public.attendance_entries,public.categories from anon;
revoke truncate,trigger,references on public.attendance_sessions,public.attendance_draft_members,public.attendance_draft_headcounts,public.attendance_entries,public.categories from authenticated;
revoke insert,update,delete on public.attendance_entries from authenticated;
grant select,insert,update,delete on public.attendance_sessions,public.attendance_draft_members,public.attendance_draft_headcounts to authenticated;
grant select on public.attendance_entries to authenticated;
grant select,insert,update,delete on public.categories to authenticated;
