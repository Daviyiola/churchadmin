-- Weekly QR recurrence. Future dates are previews; only the imminent occurrence
-- (15 minutes before opening) gets a draft. Closed occurrences are never reopened.
create schema if not exists attendance_automation;
revoke all on schema attendance_automation from public, anon;
grant usage on schema attendance_automation to authenticated, service_role;

alter table public.attendance_sessions add column checkin_service_time time;
create unique index attendance_sessions_checkin_occurrence_key
  on public.attendance_sessions(org_id,service_category_id,session_date,checkin_service_time)
  where checkin_service_time is not null and deleted_at is null;
alter table public.attendance_checkin_windows add column occurrence_date date;
create unique index attendance_checkin_windows_occurrence_key
  on public.attendance_checkin_windows(code_id,occurrence_date) where occurrence_date is not null;

create table public.attendance_checkin_schedules (
  code_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_category_id uuid not null,
  starts_on date not null,
  ends_on date,
  every_weeks integer not null check(every_weeks between 1 and 12),
  weekdays integer[] not null check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]),
  service_time time not null,
  timezone_name text not null,
  opens_before_minutes integer not null check(opens_before_minutes between 0 and 180),
  closes_after_minutes integer not null check(closes_after_minutes between 1 and 720),
  paused boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  last_error text,
  last_checked_at timestamptz,
  check(ends_on is null or ends_on >= starts_on),
  foreign key(code_id,org_id) references public.attendance_checkin_codes(id,org_id) on delete cascade,
  foreign key(service_category_id,org_id) references public.categories(id,org_id)
);
create index attendance_checkin_schedules_org_idx on public.attendance_checkin_schedules(org_id);
create index attendance_checkin_schedules_service_idx on public.attendance_checkin_schedules(service_category_id,org_id);
create index attendance_checkin_schedules_creator_idx on public.attendance_checkin_schedules(created_by);
create table public.attendance_checkin_skips (
  code_id uuid not null references public.attendance_checkin_schedules(code_id) on delete cascade,
  occurrence_date date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(code_id,occurrence_date)
);
create index attendance_checkin_skips_creator_idx on public.attendance_checkin_skips(created_by);
alter table public.attendance_checkin_schedules enable row level security;
alter table public.attendance_checkin_skips enable row level security;
revoke all on public.attendance_checkin_schedules,public.attendance_checkin_skips from anon,authenticated;
grant select on public.attendance_checkin_schedules,public.attendance_checkin_skips to authenticated;
grant all on public.attendance_checkin_schedules,public.attendance_checkin_skips to service_role;
create policy attendance_checkin_schedules_staff_read on public.attendance_checkin_schedules
  for select to authenticated using(public.is_org_data_entry(org_id));
create policy attendance_checkin_skips_staff_read on public.attendance_checkin_skips
  for select to authenticated using(exists(select 1 from public.attendance_checkin_schedules s where s.code_id=attendance_checkin_skips.code_id and public.is_org_data_entry(s.org_id)));

-- Anchor intervals to the Monday of the starting week, independent of locale.
create function attendance_automation.matches_date(p_start date,p_end date,p_weeks integer,p_days integer[],p_date date)
returns boolean language sql immutable set search_path='' as $$
  select p_date >= p_start and (p_end is null or p_date <= p_end)
    and extract(dow from p_date)::integer=any(p_days)
    and ((p_date-(p_start-(extract(isodow from p_start)::integer-1)))/7)%p_weeks=0;
$$;

-- Serialize automatic draft creation across different entrance QR codes.
-- Manual inserts share this lock and the existing UI's ten-draft limit.
create function attendance_automation.guard_draft_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='draft' and new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('attendance-drafts:'||new.org_id::text,0));
    if tg_op='INSERT' or old.status<>'draft' or old.deleted_at is not null then
      if (select count(*) from public.attendance_sessions where org_id=new.org_id and status='draft' and deleted_at is null and id<>new.id)>=10 then
        raise exception 'Max 10 attendance drafts reached. Publish or delete one before opening check-in.';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger attendance_recurring_draft_capacity before insert or update of status,deleted_at on public.attendance_sessions
  for each row execute function attendance_automation.guard_draft_capacity();

create function attendance_automation.prepare_code(p_code_id uuid,p_now timestamptz default now())
returns void language plpgsql security definer set search_path='' as $$
declare
  c public.attendance_checkin_codes; s public.attendance_checkin_schedules;
  d date; local_today date; service_at timestamptz; opening timestamptz; closing timestamptz;
  matched public.attendance_sessions; candidate_ids uuid[]; org_id_value uuid;
begin
  select org_id into org_id_value from public.attendance_checkin_codes where id=p_code_id;
  if org_id_value is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-drafts:'||org_id_value::text,0));
  select * into c from public.attendance_checkin_codes where id=p_code_id for update;
  select * into s from public.attendance_checkin_schedules where code_id=c.id for update;
  update public.attendance_checkin_windows set status='closed',closed_at=p_now,updated_at=p_now
    where code_id=c.id and status in ('scheduled','open') and closes_at<=p_now;
  update public.attendance_checkin_windows set status='open',updated_at=p_now
    where code_id=c.id and status='scheduled' and opens_at<=p_now and closes_at>p_now;
  if s.code_id is null or s.paused or c.status<>'active' then return; end if;
  begin
    if not exists(select 1 from public.organization_settings where organization_id=s.org_id and timezone_confirmed and timezone_name=s.timezone_name) then
      raise exception 'Organization timezone changed. Review and save the recurring schedule.';
    end if;
    if not exists(select 1 from public.categories where id=s.service_category_id and org_id=s.org_id and type='services' and status='active') then
      raise exception 'The scheduled service is no longer active. Choose another service.';
    end if;
    local_today=(p_now at time zone s.timezone_name)::date;
    for d in select local_today+i from generate_series(-1,1) i loop
      if not attendance_automation.matches_date(s.starts_on,s.ends_on,s.every_weeks,s.weekdays,d) then continue; end if;
      service_at=(d+s.service_time) at time zone s.timezone_name;
      opening=service_at-make_interval(mins=>s.opens_before_minutes);
      closing=service_at+make_interval(mins=>s.closes_after_minutes);
      if closing<=p_now or opening>p_now+interval '15 minutes' then continue; end if;
      -- Skip nonexistent local times during a spring DST jump; never shift silently.
      if (service_at at time zone s.timezone_name)<>(d+s.service_time) then
        raise exception 'This service time does not exist because of daylight saving time. Use a one-time window for this date.';
      end if;
      if c.expires_on is not null and closing>((c.expires_on+1)::timestamp at time zone s.timezone_name) then continue; end if;
      if exists(select 1 from public.attendance_checkin_skips where code_id=c.id and occurrence_date=d)
        or exists(select 1 from public.attendance_checkin_windows where code_id=c.id and occurrence_date=d) then continue; end if;
      if exists(select 1 from public.attendance_checkin_windows where code_id=c.id and status in ('scheduled','open')) then
        raise exception 'A manual check-in window is still assigned. Close it before automatic check-in can open.';
      end if;
      select array_agg(id) into candidate_ids from public.attendance_sessions
        where org_id=s.org_id and service_category_id=s.service_category_id and session_date=d
          and deleted_at is null and checkin_service_time=s.service_time;
      if coalesce(cardinality(candidate_ids),0)=0 then
        select array_agg(id) into candidate_ids from public.attendance_sessions
          where org_id=s.org_id and service_category_id=s.service_category_id and session_date=d
            and deleted_at is null and checkin_service_time is null;
        if coalesce(cardinality(candidate_ids),0)>0 and exists(
          select 1 from public.attendance_checkin_schedules other where other.org_id=s.org_id
            and other.service_category_id=s.service_category_id and other.service_time<>s.service_time and not other.paused
            and attendance_automation.matches_date(other.starts_on,other.ends_on,other.every_weeks,other.weekdays,d)
        ) then raise exception 'More than one service time matches this date. Attach the correct draft using a one-time window.'; end if;
      end if;
      if coalesce(cardinality(candidate_ids),0)>1 then
        raise exception 'Multiple attendance drafts match this service and date. Attach the correct draft using a one-time window.';
      elsif cardinality(candidate_ids)=1 then
        select * into matched from public.attendance_sessions where id=candidate_ids[1] for update;
        if matched.status<>'draft' then raise exception 'Attendance for this occurrence is already published. No new draft was created.'; end if;
        update public.attendance_sessions set checkin_service_time=s.service_time where id=matched.id;
      else
        insert into public.attendance_sessions(org_id,service_category_id,session_date,status,created_by,checkin_service_time)
          values(s.org_id,s.service_category_id,d,'draft',s.created_by,s.service_time) returning * into matched;
      end if;
      insert into public.attendance_checkin_windows(org_id,code_id,session_id,opens_at,closes_at,status,created_by,occurrence_date)
        values(s.org_id,c.id,matched.id,opening,closing,case when opening<=p_now then 'open' else 'scheduled' end,s.created_by,d);
    end loop;
    update public.attendance_checkin_schedules set last_error=null,last_checked_at=p_now where code_id=c.id;
  exception when others then
    update public.attendance_checkin_schedules set last_error=sqlerrm,last_checked_at=p_now where code_id=c.id;
  end;
end $$;

create function attendance_automation.save_schedule(p_code_id uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.attendance_checkin_codes; zone text; service_id uuid; days integer[];
begin
  select * into c from public.attendance_checkin_codes where id=p_code_id;
  if c.id is null or auth.uid() is null or not public.is_org_data_entry(c.org_id) then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-drafts:'||c.org_id::text,0));
  select * into c from public.attendance_checkin_codes where id=p_code_id for update;
  if c.status<>'active' then raise exception 'This QR code is revoked.'; end if;
  if exists(select 1 from public.attendance_checkin_windows where code_id=c.id and status in ('scheduled','open') and closes_at>now()) then
    raise exception 'Close the current window before changing the schedule. Changes apply to future occurrences.';
  end if;
  select timezone_name into zone from public.organization_settings where organization_id=c.org_id and timezone_confirmed;
  if zone is null then raise exception 'Confirm the organization timezone first.'; end if;
  service_id=(p_settings->>'service_category_id')::uuid;
  if not exists(select 1 from public.categories where id=service_id and org_id=c.org_id and type='services' and status='active') then raise exception 'Choose an active service in this organization.'; end if;
  select array_agg(distinct value::integer order by value::integer) into days from jsonb_array_elements_text(p_settings->'weekdays');
  insert into public.attendance_checkin_schedules(code_id,org_id,service_category_id,starts_on,ends_on,every_weeks,weekdays,service_time,timezone_name,opens_before_minutes,closes_after_minutes,created_by)
    values(c.id,c.org_id,service_id,(p_settings->>'starts_on')::date,nullif(p_settings->>'ends_on','')::date,
      (p_settings->>'every_weeks')::integer,days,(p_settings->>'service_time')::time,zone,
      (p_settings->>'opens_before_minutes')::integer,(p_settings->>'closes_after_minutes')::integer,auth.uid())
    on conflict(code_id) do update set service_category_id=excluded.service_category_id,starts_on=excluded.starts_on,ends_on=excluded.ends_on,
      every_weeks=excluded.every_weeks,weekdays=excluded.weekdays,service_time=excluded.service_time,timezone_name=excluded.timezone_name,
      opens_before_minutes=excluded.opens_before_minutes,closes_after_minutes=excluded.closes_after_minutes,updated_at=now(),last_error=null;
  perform attendance_automation.prepare_code(c.id);
end $$;

create function attendance_automation.schedule_action(p_code_id uuid,p_action text,p_date date default null)
returns void language plpgsql security definer set search_path='' as $$
declare s public.attendance_checkin_schedules;
begin
  select * into s from public.attendance_checkin_schedules where code_id=p_code_id;
  if s.code_id is null or auth.uid() is null or not public.is_org_data_entry(s.org_id) then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-drafts:'||s.org_id::text,0));
  perform 1 from public.attendance_checkin_codes where id=p_code_id for update;
  select * into s from public.attendance_checkin_schedules where code_id=p_code_id for update;
  if p_action='pause' then
    update public.attendance_checkin_schedules set paused=true,updated_at=now() where code_id=p_code_id;
    update public.attendance_checkin_windows set status='closed',closed_at=now(),closed_by=auth.uid(),updated_at=now()
      where code_id=p_code_id and occurrence_date is not null and status in ('scheduled','open');
  elsif p_action='resume' then
    update public.attendance_checkin_schedules set paused=false,updated_at=now() where code_id=p_code_id;
    perform attendance_automation.prepare_code(p_code_id);
  elsif p_action='skip' then
    if p_date is null or p_date<(now() at time zone s.timezone_name)::date or not attendance_automation.matches_date(s.starts_on,s.ends_on,s.every_weeks,s.weekdays,p_date) then raise exception 'Choose an upcoming occurrence.'; end if;
    insert into public.attendance_checkin_skips(code_id,occurrence_date,created_by) values(p_code_id,p_date,auth.uid()) on conflict do nothing;
    update public.attendance_checkin_windows set status='cancelled',closed_at=now(),closed_by=auth.uid(),updated_at=now()
      where code_id=p_code_id and occurrence_date=p_date and status in ('scheduled','open');
  else raise exception 'Choose pause, resume, or skip.';
  end if;
end $$;

create function attendance_automation.refresh_org(p_org_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare code uuid;
begin
  if auth.uid() is null or not public.is_org_data_entry(p_org_id) then raise exception 'Forbidden'; end if;
  for code in select code_id from public.attendance_checkin_schedules where org_id=p_org_id order by code_id loop
    perform attendance_automation.prepare_code(code);
  end loop;
end $$;

-- A staff-selected one-time draft resolves an ambiguous recurring match. Keep
-- an occurrence marker even when that manual window is subsequently closed.
create function attendance_automation.stamp_manual_occurrence() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.attendance_checkin_schedules; draft public.attendance_sessions;
begin
  if new.occurrence_date is not null then return new; end if;
  select * into s from public.attendance_checkin_schedules where code_id=new.code_id;
  if s.code_id is null then return new; end if;
  select * into draft from public.attendance_sessions where id=new.session_id and org_id=s.org_id;
  if draft.service_category_id=s.service_category_id and attendance_automation.matches_date(s.starts_on,s.ends_on,s.every_weeks,s.weekdays,draft.session_date)
    and (draft.checkin_service_time is null or draft.checkin_service_time=s.service_time) then
    update public.attendance_sessions set checkin_service_time=s.service_time where id=draft.id;
    if not exists(select 1 from public.attendance_checkin_windows where code_id=new.code_id and occurrence_date=draft.session_date) then
      new.occurrence_date=draft.session_date;
    end if;
    update public.attendance_checkin_schedules set last_error=null where code_id=new.code_id;
  end if;
  return new;
end $$;
create trigger attendance_stamp_manual_occurrence before insert on public.attendance_checkin_windows
  for each row execute function attendance_automation.stamp_manual_occurrence();

-- Windows cascade when a draft is deleted. Preserve the staff decision outside
-- that cascade so automation cannot recreate the just-deleted occurrence.
create function attendance_automation.remember_deleted_occurrence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or (new.deleted_at is not null and old.deleted_at is null) then
    insert into public.attendance_checkin_skips(code_id,occurrence_date,created_by)
      select w.code_id,coalesce(w.occurrence_date,old.session_date),coalesce(auth.uid(),w.created_by)
      from public.attendance_checkin_windows w join public.attendance_checkin_schedules s on s.code_id=w.code_id
      where w.session_id=old.id and s.service_category_id=old.service_category_id
        and attendance_automation.matches_date(s.starts_on,s.ends_on,s.every_weeks,s.weekdays,coalesce(w.occurrence_date,old.session_date))
      on conflict do nothing;
    update public.attendance_checkin_windows set status='closed',closed_at=now(),updated_at=now()
      where session_id=old.id and status in ('scheduled','open');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger attendance_remember_deleted_occurrence before delete or update of deleted_at on public.attendance_sessions
  for each row execute function attendance_automation.remember_deleted_occurrence();

create function attendance_automation.run_schedules() returns void
language plpgsql security definer set search_path='' as $$
declare code uuid;
begin
  for code in select s.code_id from public.attendance_checkin_schedules s join public.attendance_checkin_codes c on c.id=s.code_id
    where not s.paused and c.status='active' order by s.org_id,s.code_id loop
    perform attendance_automation.prepare_code(code);
  end loop;
end $$;

-- Only these authenticated wrappers are exposed through the Data API. The
-- private implementations explicitly verify auth.uid() and tenant membership.
create function public.save_attendance_checkin_schedule(p_code_id uuid,p_settings jsonb) returns void
language sql security invoker set search_path='' as $$select attendance_automation.save_schedule(p_code_id,p_settings);$$;
create function public.act_attendance_checkin_schedule(p_code_id uuid,p_action text,p_date date default null) returns void
language sql security invoker set search_path='' as $$select attendance_automation.schedule_action(p_code_id,p_action,p_date);$$;
create function public.refresh_attendance_checkin_schedules(p_org_id uuid) returns void
language sql security invoker set search_path='' as $$select attendance_automation.refresh_org(p_org_id);$$;
revoke all on all functions in schema attendance_automation from public,anon,authenticated;
grant execute on function attendance_automation.save_schedule(uuid,jsonb),attendance_automation.schedule_action(uuid,text,date),attendance_automation.refresh_org(uuid) to authenticated;
grant execute on function attendance_automation.run_schedules() to service_role;
revoke all on function public.save_attendance_checkin_schedule(uuid,jsonb),public.act_attendance_checkin_schedule(uuid,text,date),public.refresh_attendance_checkin_schedules(uuid) from public,anon;
grant execute on function public.save_attendance_checkin_schedule(uuid,jsonb),public.act_attendance_checkin_schedule(uuid,text,date),public.refresh_attendance_checkin_schedules(uuid) to authenticated;

select cron.schedule('attendance-recurring-checkin','* * * * *',$$select attendance_automation.run_schedules();$$);
