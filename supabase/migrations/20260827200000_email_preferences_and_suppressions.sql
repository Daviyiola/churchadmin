create table public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  email text not null,
  email_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_contacts_email_norm_check
    check (email_norm = pg_catalog.lower(pg_catalog.btrim(email)) and pg_catalog.length(email_norm) between 3 and 254),
  constraint email_contacts_org_email_key unique (org_id, email_norm)
);

create index email_contacts_member_idx on public.email_contacts(org_id, member_id)
  where member_id is not null;

create table public.email_topic_preferences (
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  topic text not null,
  subscribed boolean not null default true,
  source text not null default 'recipient',
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (contact_id, topic),
  constraint email_topic_preferences_topic_check check (
    topic = any (array['broadcast','followup','form_invite','giving_statement'])
  ),
  constraint email_topic_preferences_source_check check (
    source = any (array['recipient','one_click','staff','migration','system'])
  )
);

create table public.email_preference_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.email_contacts(id) on delete set null,
  topic text not null,
  action text not null,
  source text not null,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  request_hash text,
  created_at timestamptz not null default now(),
  constraint email_preference_events_topic_check check (
    topic = any (array['broadcast','followup','form_invite','giving_statement','all_optional'])
  ),
  constraint email_preference_events_action_check check (action = any (array['subscribe','unsubscribe']))
);

create index email_preference_events_contact_created_idx
  on public.email_preference_events(contact_id, created_at desc);

create table public.email_global_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_norm text not null unique,
  reason text not null,
  provider_event_id text,
  details text,
  suppressed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  constraint email_global_suppressions_email_norm_check
    check (email_norm = pg_catalog.lower(pg_catalog.btrim(email)) and pg_catalog.length(email_norm) between 3 and 254),
  constraint email_global_suppressions_reason_check check (
    reason = any (array['hard_bounce','complaint','provider_suppressed','manual'])
  )
);

create index email_global_suppressions_active_idx
  on public.email_global_suppressions(email_norm) where released_at is null;

create table public.email_provider_events (
  provider text not null default 'resend',
  provider_event_id text primary key,
  event_type text not null,
  email_norm text,
  provider_email_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text not null default 'received',
  error text,
  constraint email_provider_events_outcome_check check (
    outcome = any (array['received','processed','ignored','failed'])
  )
);

create table public.user_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  product_updates boolean not null default true,
  onboarding_tips boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.email_preference_rate_events (
  id bigint generated always as identity primary key,
  request_hash text not null,
  created_at timestamptz not null default now()
);

create index email_preference_rate_events_hash_created_idx
  on public.email_preference_rate_events(request_hash, created_at desc);

alter table public.organization_settings
  add column mailing_address_line1 text,
  add column mailing_address_line2 text,
  add column mailing_city text,
  add column mailing_state text,
  add column mailing_postal_code text,
  add column mailing_country text not null default 'US';

alter table public.communication_audience_snapshots
  add column unsubscribed_count integer not null default 0 check (unsubscribed_count >= 0),
  add column suppressed_count integer not null default 0 check (suppressed_count >= 0);

alter table public.communication_audience_snapshot_recipients
  add column outcome text,
  add column skipped_reason text,
  add constraint communication_snapshot_recipient_outcome_check check (
    outcome is null or outcome = any (array['sent','failed','skipped_unsubscribed','skipped_suppressed'])
  );

alter table public.communication_campaigns
  add column total_skipped integer not null default 0 check (total_skipped >= 0);

alter table public.report_email_job_recipients
  add column skipped_reason text;

alter table public.scheduled_followups drop constraint scheduled_followups_status_check;
alter table public.scheduled_followups add constraint scheduled_followups_status_check check (
  status = any (array['pending','sent','failed','cancelled','blocked_quota','blocked_preference'])
);

alter table public.email_contacts enable row level security;
alter table public.email_topic_preferences enable row level security;
alter table public.email_preference_events enable row level security;
alter table public.email_global_suppressions enable row level security;
alter table public.email_provider_events enable row level security;
alter table public.user_email_preferences enable row level security;
alter table public.email_preference_rate_events enable row level security;

revoke all on table public.email_contacts from public, anon, authenticated;
revoke all on table public.email_topic_preferences from public, anon, authenticated;
revoke all on table public.email_preference_events from public, anon, authenticated;
revoke all on table public.email_global_suppressions from public, anon, authenticated;
revoke all on table public.email_provider_events from public, anon, authenticated;
revoke all on table public.user_email_preferences from public, anon, authenticated;
revoke all on table public.email_preference_rate_events from public, anon, authenticated;
grant select, insert, update, delete on table public.email_contacts to service_role;
grant select, insert, update, delete on table public.email_topic_preferences to service_role;
grant select, insert on table public.email_preference_events to service_role;
grant select, insert, update on table public.email_global_suppressions to service_role;
grant select, insert, update on table public.email_provider_events to service_role;
grant select, insert, update on table public.user_email_preferences to service_role;
grant select, insert, delete on table public.email_preference_rate_events to service_role;
grant usage, select on sequence public.email_preference_rate_events_id_seq to service_role;

create or replace function private.repoint_merged_email_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.email_contacts%rowtype;
  v_target_id uuid;
begin
  if new.status <> 'merged' or new.merged_into_member_id is null then
    return new;
  end if;

  for v_source in
    select * from public.email_contacts
    where org_id = new.org_id and member_id = new.id
    for update
  loop
    select id into v_target_id
    from public.email_contacts
    where org_id = new.org_id
      and email_norm = v_source.email_norm
      and member_id = new.merged_into_member_id
    limit 1;

    if v_target_id is null then
      update public.email_contacts
      set member_id = new.merged_into_member_id, updated_at = now()
      where id = v_source.id;
    else
      insert into public.email_topic_preferences(contact_id, topic, subscribed, source, reason, changed_at)
      select v_target_id, p.topic, p.subscribed, 'system', 'Preserved during member merge', now()
      from public.email_topic_preferences p where p.contact_id = v_source.id
      on conflict (contact_id, topic) do update
      set subscribed = public.email_topic_preferences.subscribed and excluded.subscribed,
          source = 'system', reason = 'Most restrictive preference preserved during member merge', changed_at = now();

      update public.email_preference_events set contact_id = v_target_id where contact_id = v_source.id;
      delete from public.email_contacts where id = v_source.id;
    end if;
    v_target_id := null;
  end loop;
  return new;
end;
$$;

revoke all on function private.repoint_merged_email_contacts() from public, anon, authenticated;

create trigger members_repoint_email_contacts_after_merge
after update of status, merged_into_member_id on public.members
for each row execute function private.repoint_merged_email_contacts();

comment on table public.email_contacts is 'Organization-scoped recipient identities used for email preferences.';
comment on table public.email_preference_events is 'Append-only audit trail; application users receive no direct write access.';
comment on table public.email_global_suppressions is 'Provider-wide delivery suppressions that override organization preferences.';
