create table public.sms_organization_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','draft','ready_for_provider','provider_pending','action_required','approved','rejected','paused')),
  provider_key text,
  provider_account_id text,
  provider_connection_status text not null default 'not_connected'
    check (provider_connection_status in ('not_connected','pending','active','action_required','suspended')),
  default_country text not null default 'US' check (default_country = 'US'),
  phone_number_e164 text check (phone_number_e164 is null or phone_number_e164 ~ '^\\+1[2-9][0-9]{9}$'),
  area_code_preference text check (area_code_preference is null or area_code_preference ~ '^[2-9][0-9]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.sms_onboarding_drafts (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  current_step smallint not null default 1 check (current_step between 1 and 8),
  organization_type text check (organization_type is null or organization_type in ('nonprofit_church','unincorporated_fellowship','other')),
  representative_name text,
  representative_title text,
  representative_email text,
  representative_phone text,
  has_ein boolean,
  has_identity_documents boolean,
  has_payment_method boolean,
  has_website boolean,
  website_url text,
  messaging_purposes text[] not null default '{}',
  estimated_monthly_segments integer check (estimated_monthly_segments is null or estimated_monthly_segments >= 0),
  consent_methods text[] not null default '{}',
  sample_announcement text,
  sample_reminder text,
  sample_follow_up text,
  sample_help_reply text,
  sample_stop_reply text,
  area_code_preference text check (area_code_preference is null or area_code_preference ~ '^[2-9][0-9]{2}$'),
  number_preference text check (number_preference is null or number_preference in ('new_number','port_existing','undecided')),
  completed_steps smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (cardinality(messaging_purposes) <= 6),
  check (messaging_purposes <@ array['announcement','reminder','follow_up','event','fundraising','other']::text[]),
  check (cardinality(consent_methods) <= 6),
  check (consent_methods <@ array['paper_form','online_form','verbal','membership_process','event_registration','other']::text[])
);

create table public.sms_consent_attestations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version >= 1),
  statement_version text not null,
  statement_text text not null check (char_length(btrim(statement_text)) between 20 and 5000),
  scope text not null default 'church_communications' check (scope = 'church_communications'),
  ongoing_policy boolean not null default true,
  attested_by uuid not null references auth.users(id) on delete restrict,
  role_snapshot text not null check (role_snapshot in ('owner','admin','finance')),
  attested_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text,
  unique (org_id, version),
  check ((revoked_at is null and revoked_by is null) or revoked_at is not null)
);
create unique index sms_consent_attestations_current_idx
  on public.sms_consent_attestations(org_id, scope) where revoked_at is null;

create table public.sms_contact_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\\+1[2-9][0-9]{9}$'),
  member_id uuid references public.members(id) on delete set null,
  source_type text not null check (source_type in ('form_submission','staff_recorded','keyword','provider_import','individual_override')),
  source_id uuid,
  form_id uuid references public.forms(id) on delete set null,
  form_submission_id uuid references public.form_submissions(id) on delete set null,
  form_version integer,
  consent_field_key uuid,
  consent_field_label text,
  consent_answer text,
  scope text not null default 'church_communications' check (scope = 'church_communications'),
  status text not null check (status in ('granted','revoked')),
  obtained_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_type <> 'form_submission' or (form_id is not null and form_submission_id is not null and consent_field_key is not null and consent_answer is not null)),
  check ((status = 'granted' and revoked_at is null) or status = 'revoked')
);
create index sms_contact_consents_org_phone_idx on public.sms_contact_consents(org_id, phone_e164, obtained_at desc);
create index sms_contact_consents_member_idx on public.sms_contact_consents(member_id) where member_id is not null;
create index sms_contact_consents_submission_idx on public.sms_contact_consents(form_submission_id) where form_submission_id is not null;

create table public.sms_suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\\+1[2-9][0-9]{9}$'),
  source text not null check (source in ('stop','staff','provider','revoked_consent')),
  reason text,
  provider_event_id text,
  suppressed_at timestamptz not null default now(),
  suppressed_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  check ((released_at is null and released_by is null) or released_at is not null)
);
create unique index sms_suppressions_active_idx on public.sms_suppressions(org_id, phone_e164) where released_at is null;
create index sms_suppressions_org_time_idx on public.sms_suppressions(org_id, suppressed_at desc);

create table public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null default 'Untitled SMS campaign' check (char_length(btrim(title)) between 1 and 120),
  body_text text not null default '' check (char_length(body_text) <= 1600),
  purpose text not null default 'announcement' check (purpose in ('announcement','reminder','follow_up','event','fundraising','other')),
  status text not null default 'draft' check (status in ('draft','ready','schedule_intent','archived')),
  audience_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(audience_criteria) = 'object'),
  scheduled_for timestamptz,
  timezone_name text,
  message_encoding text check (message_encoding is null or message_encoding in ('gsm7','unicode')),
  character_count integer not null default 0 check (character_count between 0 and 1600),
  segments_per_recipient integer not null default 0 check (segments_per_recipient >= 0),
  estimated_total_segments integer not null default 0 check (estimated_total_segments >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status <> 'schedule_intent' or scheduled_for is not null)
);
create index sms_campaigns_org_status_updated_idx on public.sms_campaigns(org_id, status, updated_at desc);
create index sms_campaigns_created_by_idx on public.sms_campaigns(created_by);
create index sms_campaigns_updated_by_idx on public.sms_campaigns(updated_by);

create table public.sms_audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.sms_campaigns(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  source_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(source_counts) = 'object'),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  body_hash text not null,
  character_count integer not null check (character_count between 0 and 1600),
  message_encoding text not null check (message_encoding in ('gsm7','unicode')),
  max_segments_per_recipient integer not null check (max_segments_per_recipient >= 0),
  estimated_total_segments integer not null check (estimated_total_segments >= 0),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index sms_audience_snapshots_org_created_idx on public.sms_audience_snapshots(org_id, created_at desc);
create index sms_audience_snapshots_campaign_idx on public.sms_audience_snapshots(campaign_id, created_at desc) where campaign_id is not null;
create index sms_audience_snapshots_expiry_idx on public.sms_audience_snapshots(expires_at) where consumed_at is null;

create table public.sms_audience_snapshot_recipients (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.sms_audience_snapshots(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  phone_e164 text not null check (phone_e164 ~ '^\\+1[2-9][0-9]{9}$'),
  display_name text,
  source_types text[] not null default '{}',
  source_labels text[] not null default '{}',
  consent_basis text not null check (consent_basis in ('organization_attestation','explicit_form_consent','individual_consent')),
  consent_reference_id uuid,
  personalized_character_count integer not null default 0 check (personalized_character_count between 0 and 1600),
  personalized_segments integer not null default 0 check (personalized_segments >= 0),
  created_at timestamptz not null default now(),
  unique (snapshot_id, phone_e164)
);
create index sms_snapshot_recipients_org_idx on public.sms_audience_snapshot_recipients(org_id, snapshot_id);
create index sms_snapshot_recipients_member_idx on public.sms_audience_snapshot_recipients(member_id) where member_id is not null;

alter table public.sms_campaigns add column latest_snapshot_id uuid references public.sms_audience_snapshots(id) on delete set null;
create index sms_campaigns_latest_snapshot_idx on public.sms_campaigns(latest_snapshot_id) where latest_snapshot_id is not null;

create table public.sms_usage_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.sms_campaigns(id) on delete set null,
  provider_key text,
  event_type text not null check (event_type in ('estimated','actual','adjustment')),
  segments integer not null,
  cost_cents numeric(12,4),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index sms_usage_ledger_org_created_idx on public.sms_usage_ledger(org_id, created_at desc);
create index sms_usage_ledger_campaign_idx on public.sms_usage_ledger(campaign_id) where campaign_id is not null;

alter table public.sms_organization_settings enable row level security;
alter table public.sms_onboarding_drafts enable row level security;
alter table public.sms_consent_attestations enable row level security;
alter table public.sms_contact_consents enable row level security;
alter table public.sms_suppressions enable row level security;
alter table public.sms_campaigns enable row level security;
alter table public.sms_audience_snapshots enable row level security;
alter table public.sms_audience_snapshot_recipients enable row level security;
alter table public.sms_usage_ledger enable row level security;

revoke all on table public.sms_organization_settings, public.sms_onboarding_drafts,
  public.sms_consent_attestations, public.sms_contact_consents, public.sms_suppressions,
  public.sms_campaigns, public.sms_audience_snapshots,
  public.sms_audience_snapshot_recipients, public.sms_usage_ledger
  from public, anon, authenticated;
grant select, insert, update, delete on table public.sms_organization_settings,
  public.sms_onboarding_drafts, public.sms_consent_attestations,
  public.sms_contact_consents, public.sms_suppressions, public.sms_campaigns,
  public.sms_audience_snapshots, public.sms_audience_snapshot_recipients,
  public.sms_usage_ledger to service_role;
grant usage, select on sequence public.sms_usage_ledger_id_seq to service_role;

create policy sms_settings_service_only on public.sms_organization_settings for all to service_role using (true) with check (true);
create policy sms_onboarding_service_only on public.sms_onboarding_drafts for all to service_role using (true) with check (true);
create policy sms_attestations_service_only on public.sms_consent_attestations for all to service_role using (true) with check (true);
create policy sms_consents_service_only on public.sms_contact_consents for all to service_role using (true) with check (true);
create policy sms_suppressions_service_only on public.sms_suppressions for all to service_role using (true) with check (true);
create policy sms_campaigns_service_only on public.sms_campaigns for all to service_role using (true) with check (true);
create policy sms_snapshots_service_only on public.sms_audience_snapshots for all to service_role using (true) with check (true);
create policy sms_snapshot_recipients_service_only on public.sms_audience_snapshot_recipients for all to service_role using (true) with check (true);
create policy sms_usage_service_only on public.sms_usage_ledger for all to service_role using (true) with check (true);

create or replace function public.complete_sms_onboarding(
  p_org_id uuid,
  p_actor_id uuid,
  p_role text,
  p_statement_version text,
  p_statement_text text
) returns table(attestation_id uuid, attestation_version integer, onboarding_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.sms_onboarding_drafts%rowtype;
  v_version integer;
  v_attestation_id uuid;
begin
  if p_role not in ('owner','admin','finance') then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = p_org_id and uo.user_id = p_actor_id and uo.role = p_role
  ) then raise exception 'FORBIDDEN'; end if;

  select * into v_draft from public.sms_onboarding_drafts d where d.org_id = p_org_id for update;
  if v_draft.org_id is null then raise exception 'SMS_SETUP_INCOMPLETE'; end if;
  if v_draft.organization_type is null
     or nullif(btrim(v_draft.representative_name), '') is null
     or nullif(btrim(v_draft.representative_title), '') is null
     or nullif(btrim(v_draft.representative_email), '') is null
     or cardinality(v_draft.messaging_purposes) = 0
     or v_draft.estimated_monthly_segments is null
     or cardinality(v_draft.consent_methods) = 0
     or nullif(btrim(v_draft.sample_announcement), '') is null
     or nullif(btrim(v_draft.sample_help_reply), '') is null
     or nullif(btrim(v_draft.sample_stop_reply), '') is null
     or v_draft.number_preference is null
  then raise exception 'SMS_SETUP_INCOMPLETE'; end if;

  update public.sms_consent_attestations
    set revoked_at = now(), revoked_by = p_actor_id,
        revocation_reason = 'Superseded by a newer organization attestation.'
    where org_id = p_org_id and scope = 'church_communications' and revoked_at is null;

  select coalesce(max(a.version), 0) + 1 into v_version
    from public.sms_consent_attestations a where a.org_id = p_org_id;
  insert into public.sms_consent_attestations(
    org_id, version, statement_version, statement_text, scope,
    ongoing_policy, attested_by, role_snapshot
  ) values (
    p_org_id, v_version, p_statement_version, p_statement_text,
    'church_communications', true, p_actor_id, p_role
  ) returning id into v_attestation_id;

  insert into public.sms_organization_settings(
    org_id, onboarding_status, provider_connection_status, default_country,
    area_code_preference, updated_by
  ) values (
    p_org_id, 'ready_for_provider', 'not_connected', 'US',
    v_draft.area_code_preference, p_actor_id
  ) on conflict (org_id) do update set
    onboarding_status = 'ready_for_provider',
    area_code_preference = excluded.area_code_preference,
    updated_at = now(), updated_by = p_actor_id;

  return query select v_attestation_id, v_version, 'ready_for_provider'::text;
end;
$$;

revoke all on function public.complete_sms_onboarding(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_sms_onboarding(uuid,uuid,text,text,text) to service_role;

comment on table public.sms_organization_settings is 'Provider-neutral SMS readiness and future connection state. Provider secrets are never stored here.';
comment on table public.sms_consent_attestations is 'Versioned organization attestations supporting canonical church communications eligibility.';
comment on table public.sms_audience_snapshots is 'Immutable expiring recipient reviews; a future sender must recheck suppression and authorization.';
comment on column public.sms_campaigns.scheduled_for is 'Non-executing schedule intention until a provider is active and the audience is freshly confirmed.';
