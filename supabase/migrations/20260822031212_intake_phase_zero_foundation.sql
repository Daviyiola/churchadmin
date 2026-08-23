-- Phase 0 foundation for the existing first-timer intake flows.
-- Public browsers continue to use Church Admin routes; only the server-side
-- service role can execute these transactional functions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.intake_rate_events (
  id bigint generated always as identity primary key,
  scope text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint intake_rate_events_scope_check
    check (char_length(scope) between 1 and 180),
  constraint intake_rate_events_fingerprint_check
    check (fingerprint ~ '^[a-f0-9]{64}$')
);

create index intake_rate_events_scope_fingerprint_created_idx
  on private.intake_rate_events (scope, fingerprint, created_at desc);

alter table private.intake_rate_events enable row level security;
revoke all on table private.intake_rate_events from public, anon, authenticated;

create table private.intake_campaign_submission_receipts (
  campaign_id uuid not null references public.intake_campaigns(id) on delete cascade,
  request_id uuid not null,
  result_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, request_id)
);

create index intake_campaign_receipts_created_idx
  on private.intake_campaign_submission_receipts (created_at);

alter table private.intake_campaign_submission_receipts enable row level security;
revoke all on table private.intake_campaign_submission_receipts
  from public, anon, authenticated;

create or replace function private.render_intake_template(
  p_template text,
  p_first_name text,
  p_last_name text,
  p_church_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(p_template, '{firstName}', coalesce(p_first_name, '')),
      '{lastName}', coalesce(p_last_name, '')
    ),
    '{churchName}', coalesce(p_church_name, '')
  );
$$;

revoke all on function private.render_intake_template(text, text, text, text)
  from public, anon, authenticated;

create or replace function private.schedule_intake_followups(
  p_org_id uuid,
  p_member_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_first_visit date
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if nullif(pg_catalog.btrim(coalesce(p_email, '')), '') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from public.followup_settings fs
    where fs.org_id = p_org_id
      and fs.automation_enabled
  ) then
    return 0;
  end if;

  with settings as (
    select
      fs.default_reply_to,
      fs.send_time,
      case
        when exists (
          select 1
          from pg_catalog.pg_timezone_names tz
          where tz.name = fs.timezone_name
        ) then fs.timezone_name
        else 'America/New_York'
      end as timezone_name
    from public.followup_settings fs
    where fs.org_id = p_org_id
      and fs.automation_enabled
  ), configured_templates as (
    select
      t.step_order,
      t.day_offset,
      t.label,
      t.subject,
      t.body
    from public.followup_automation_templates t
    where t.org_id = p_org_id
  ), default_templates(step_order, day_offset, label, subject, body) as (
    values
      (1::smallint, 0, 'Day 0: Thank you for visiting',
       'Thank you for visiting {churchName}',
       E'Hi {firstName},\n\nThank you for visiting {churchName}. It was a blessing to have you with us.\n\nWe hope you felt welcomed, and we would love to see you again soon.\n\nBlessings,\n{churchName}'),
      (2::smallint, 3, 'Day 3: Hope to see you again',
       'We hope to see you again soon',
       E'Hi {firstName},\n\nWe just wanted to check in and say we were glad you visited {churchName}.\n\nIf you have any questions or prayer requests, feel free to reply to this email.\n\nBlessings,\n{churchName}'),
      (3::smallint, 7, 'Day 7: Invite to community group',
       'Would you like to connect with a group?',
       E'Hi {firstName},\n\nWe would love to help you get more connected at {churchName}.\n\nIf you are interested, we can share more information about our community groups, ministries, or next steps.\n\nBlessings,\n{churchName}'),
      (4::smallint, 14, 'Day 14: Pastoral check-in',
       'Checking in from {churchName}',
       E'Hi {firstName},\n\nWe wanted to check in again and let you know we are grateful you visited {churchName}.\n\nPlease let us know if there is any way we can pray for you or support you.\n\nBlessings,\n{churchName}')
  ), templates as (
    select * from configured_templates
    union all
    select * from default_templates
    where not exists (select 1 from configured_templates)
  ), church as (
    select coalesce(nullif(pg_catalog.btrim(o.name), ''), 'Our Church') as name
    from public.organizations o
    where o.id = p_org_id
  )
  insert into public.scheduled_followups (
    org_id,
    member_id,
    channel,
    followup_label,
    day_offset,
    scheduled_for,
    subject,
    body,
    reply_to,
    status
  )
  select
    p_org_id,
    p_member_id,
    'email',
    t.label,
    t.day_offset,
    ((p_first_visit + s.send_time + pg_catalog.make_interval(days => t.day_offset))
      at time zone s.timezone_name),
    private.render_intake_template(t.subject, p_first_name, p_last_name, c.name),
    private.render_intake_template(t.body, p_first_name, p_last_name, c.name),
    s.default_reply_to,
    'pending'
  from templates t
  cross join settings s
  cross join church c
  order by t.step_order
  on conflict (org_id, member_id, day_offset) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.schedule_intake_followups(
  uuid, uuid, text, text, text, date
) from public, anon, authenticated;

create or replace function public.consume_intake_rate_limit(
  p_scope text,
  p_fingerprint text,
  p_limit integer,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if nullif(pg_catalog.btrim(p_scope), '') is null
     or char_length(p_scope) > 180
     or p_fingerprint !~ '^[a-f0-9]{64}$'
     or p_limit < 1 or p_limit > 500
     or p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_scope || ':' || p_fingerprint)
  );

  select count(*)::integer
  into v_count
  from private.intake_rate_events e
  where e.scope = p_scope
    and e.fingerprint = p_fingerprint
    and e.created_at >= pg_catalog.clock_timestamp()
      - pg_catalog.make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    raise exception 'INTAKE_RATE_LIMITED';
  end if;

  insert into private.intake_rate_events (scope, fingerprint)
  values (p_scope, p_fingerprint);

  -- Opportunistic bounded retention. This is intentionally independent of
  -- user-facing data and does not retain raw addresses.
  delete from private.intake_rate_events
  where created_at < pg_catalog.clock_timestamp() - interval '24 hours';

  return v_count + 1;
end;
$$;

revoke all on function public.consume_intake_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_intake_rate_limit(text, text, integer, integer)
  to service_role;

create or replace function public.create_personal_intake_invitation(
  p_org_id uuid,
  p_actor_id uuid,
  p_first_name text,
  p_email text,
  p_token text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Forbidden';
  end if;

  if nullif(pg_catalog.btrim(p_first_name), '') is null
     or nullif(pg_catalog.btrim(p_email), '') is null
     or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or char_length(p_token) < 32
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '7 days 5 minutes' then
    raise exception 'Invalid intake invitation';
  end if;

  insert into public.members (
    org_id, membership_stage, profile_complete, first_name, last_name,
    email, status, created_by, updated_by
  ) values (
    p_org_id, 'visitor', false, pg_catalog.btrim(p_first_name), null,
    pg_catalog.lower(pg_catalog.btrim(p_email)), 'active', p_actor_id, p_actor_id
  ) returning id into v_member_id;

  insert into public.visitor_details (
    member_id, first_visit_at, follow_up_status, next_follow_up_at, updated_at
  ) values (
    v_member_id, v_now::date, 'new', (v_now::date + 3), v_now
  );

  insert into public.intake_tokens (
    token, org_id, member_id, invited_email, expires_at, used_at, created_by
  ) values (
    p_token, p_org_id, v_member_id, pg_catalog.lower(pg_catalog.btrim(p_email)),
    p_expires_at, null, p_actor_id
  );

  return pg_catalog.jsonb_build_object('member_id', v_member_id);
end;
$$;

revoke all on function public.create_personal_intake_invitation(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_personal_intake_invitation(
  uuid, uuid, text, text, text, timestamptz
) to service_role;

create or replace function public.complete_personal_intake(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_marital_status text,
  p_children_count integer,
  p_gender text,
  p_age_group text,
  p_how_heard text,
  p_prayer_request_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.intake_tokens%rowtype;
  v_member public.members%rowtype;
  v_first_visit date;
  v_scheduled integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_token
  from public.intake_tokens t
  where t.token = p_token
  for update;

  if v_token.token is null then raise exception 'INTAKE_INVALID'; end if;
  if v_token.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if v_token.expires_at <= v_now then raise exception 'INTAKE_EXPIRED'; end if;

  select * into v_member
  from public.members m
  where m.id = v_token.member_id
    and m.org_id = v_token.org_id
  for update;

  if v_member.id is null or v_member.status = 'merged' then
    raise exception 'INTAKE_INVALID';
  end if;

  if nullif(pg_catalog.btrim(p_first_name), '') is null
     or nullif(pg_catalog.btrim(p_last_name), '') is null
     or nullif(pg_catalog.btrim(p_phone), '') is null
     or p_gender not in ('male', 'female')
     or p_age_group not in ('1-12', '13-17', '18-35', '36+')
     or p_children_count is not null and p_children_count < 0
     or pg_catalog.lower(pg_catalog.btrim(p_email))
        is distinct from pg_catalog.lower(pg_catalog.btrim(v_token.invited_email)) then
    raise exception 'INTAKE_INVALID_FIELDS';
  end if;

  update public.members
  set first_name = pg_catalog.btrim(p_first_name),
      last_name = pg_catalog.btrim(p_last_name),
      email = pg_catalog.lower(pg_catalog.btrim(p_email)),
      phone = pg_catalog.btrim(p_phone),
      address = nullif(pg_catalog.btrim(coalesce(p_address, '')), ''),
      marital_status = nullif(pg_catalog.btrim(coalesce(p_marital_status, '')), ''),
      children_count = p_children_count,
      gender = p_gender,
      age_group = p_age_group,
      segment = public.compute_segment(p_gender, p_age_group),
      membership_stage = 'visitor',
      profile_complete = true,
      updated_at = v_now
  where id = v_member.id;

  insert into public.visitor_details (
    member_id, first_visit_at, follow_up_status, how_heard,
    prayer_request_tags, next_follow_up_at, updated_at
  ) values (
    v_member.id, v_now::date, 'new',
    nullif(pg_catalog.btrim(coalesce(p_how_heard, '')), ''),
    p_prayer_request_tags, v_now::date + 3, v_now
  )
  on conflict (member_id) do update
  set first_visit_at = coalesce(public.visitor_details.first_visit_at, excluded.first_visit_at),
      how_heard = excluded.how_heard,
      prayer_request_tags = excluded.prayer_request_tags,
      next_follow_up_at = coalesce(public.visitor_details.next_follow_up_at, excluded.next_follow_up_at),
      updated_at = excluded.updated_at;

  select vd.first_visit_at into v_first_visit
  from public.visitor_details vd
  where vd.member_id = v_member.id;

  v_scheduled := private.schedule_intake_followups(
    v_token.org_id,
    v_member.id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    coalesce(v_first_visit, v_now::date)
  );

  update public.intake_tokens
  set used_at = v_now
  where token = v_token.token;

  return pg_catalog.jsonb_build_object(
    'member_id', v_member.id,
    'followups_scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.complete_personal_intake(
  text, text, text, text, text, text, text, integer, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.complete_personal_intake(
  text, text, text, text, text, text, text, integer, text, text, text, text[]
) to service_role;

create or replace function public.create_campaign_intake_visitor(
  p_slug text,
  p_request_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_marital_status text,
  p_children_count integer,
  p_gender text,
  p_age_group text,
  p_how_heard text,
  p_prayer_request_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.intake_campaigns%rowtype;
  v_existing_member_id uuid;
  v_member_id uuid;
  v_scheduled integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_request_id is null then raise exception 'INTAKE_INVALID_REQUEST'; end if;

  select * into v_campaign
  from public.intake_campaigns c
  where c.slug = p_slug
  for update;

  if v_campaign.id is null then raise exception 'INTAKE_INVALID'; end if;
  if not v_campaign.is_active then raise exception 'INTAKE_INACTIVE'; end if;
  if v_campaign.expires_at is not null and v_campaign.expires_at <= v_now then
    raise exception 'INTAKE_EXPIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_campaign.id::text || ':' || p_request_id::text)
  );

  select r.result_member_id into v_existing_member_id
  from private.intake_campaign_submission_receipts r
  where r.campaign_id = v_campaign.id
    and r.request_id = p_request_id;

  if found then
    return pg_catalog.jsonb_build_object(
      'member_id', v_existing_member_id,
      'followups_scheduled', 0,
      'idempotent', true
    );
  end if;

  if nullif(pg_catalog.btrim(p_first_name), '') is null
     or nullif(pg_catalog.btrim(p_last_name), '') is null
     or nullif(pg_catalog.btrim(p_phone), '') is null
     or nullif(pg_catalog.btrim(p_email), '') is null
     or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_gender not in ('male', 'female')
     or p_age_group not in ('1-12', '13-17', '18-35', '36+')
     or p_children_count is not null and p_children_count < 0 then
    raise exception 'INTAKE_INVALID_FIELDS';
  end if;

  insert into public.members (
    org_id, first_name, last_name, email, phone, address,
    marital_status, children_count, gender, age_group, segment,
    membership_stage, profile_complete, status, created_at, updated_at
  ) values (
    v_campaign.org_id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    pg_catalog.btrim(p_phone),
    nullif(pg_catalog.btrim(coalesce(p_address, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_marital_status, '')), ''),
    p_children_count,
    p_gender,
    p_age_group,
    public.compute_segment(p_gender, p_age_group),
    'visitor', true, 'active', v_now, v_now
  ) returning id into v_member_id;

  insert into public.visitor_details (
    member_id, first_visit_at, follow_up_status, how_heard,
    prayer_request_tags, next_follow_up_at, updated_at
  ) values (
    v_member_id, v_now::date, 'new',
    nullif(pg_catalog.btrim(coalesce(p_how_heard, '')), ''),
    p_prayer_request_tags, v_now::date + 3, v_now
  );

  v_scheduled := private.schedule_intake_followups(
    v_campaign.org_id,
    v_member_id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    v_now::date
  );

  insert into private.intake_campaign_submission_receipts (
    campaign_id, request_id, result_member_id
  ) values (
    v_campaign.id, p_request_id, v_member_id
  );

  return pg_catalog.jsonb_build_object(
    'member_id', v_member_id,
    'followups_scheduled', v_scheduled,
    'idempotent', false
  );
end;
$$;

revoke all on function public.create_campaign_intake_visitor(
  text, uuid, text, text, text, text, text, text, integer, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.create_campaign_intake_visitor(
  text, uuid, text, text, text, text, text, text, integer, text, text, text, text[]
) to service_role;

-- The browser never calls these legacy token helpers directly. Keep them
-- available only to server-side privileged code while existing links remain.
revoke all on function public.intake_token_lookup(text) from public, anon, authenticated;
revoke all on function public.intake_token_consume(text) from public, anon, authenticated;
grant execute on function public.intake_token_lookup(text) to service_role;
grant execute on function public.intake_token_consume(text) to service_role;

create index if not exists intake_campaigns_org_id_idx
  on public.intake_campaigns (org_id);
