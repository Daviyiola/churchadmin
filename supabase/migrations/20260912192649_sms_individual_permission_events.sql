-- Append-only, server-managed evidence. Legacy blanket attestations are not migrated into grants.
create table public.sms_permission_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^[+]1[2-9][0-9]{9}$'),
  category text not null check (category in ('informational','promotional')),
  status text not null check (status in ('granted','revoked')),
  method text not null check (method in ('verbal','written','staff_opt_out')),
  disclosure text not null check (char_length(btrim(disclosure)) between 20 and 5000),
  evidence_note text not null default '' check (char_length(evidence_note) <= 2000),
  obtained_at timestamptz not null check (obtained_at <= now()),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'revoked' and method = 'staff_opt_out') or
    (status = 'granted' and method in ('verbal','written'))),
  check (status <> 'granted' or category <> 'promotional' or method = 'written'),
  check (method <> 'written' or char_length(btrim(evidence_note)) >= 10)
);
create index sms_permission_events_lookup_idx on public.sms_permission_events(org_id, phone_e164, category, obtained_at desc, created_at desc);
create index sms_permission_events_actor_idx on public.sms_permission_events(recorded_by) where recorded_by is not null;
alter table public.sms_permission_events enable row level security;
revoke all on public.sms_permission_events from public, anon, authenticated;
grant select, insert on public.sms_permission_events to service_role;
revoke update, delete, truncate on public.sms_permission_events from service_role;
comment on table public.sms_permission_events is 'Individual SMS permission history. Access only through authenticated organization-scoped server routes. Suppressions always override grants.';

-- The foundation used a doubled backslash in standard SQL strings, rejecting valid +1 phones.
alter table public.sms_organization_settings drop constraint sms_organization_settings_phone_number_e164_check;
alter table public.sms_organization_settings add constraint sms_organization_settings_phone_number_e164_check
  check (phone_number_e164 is null or phone_number_e164 ~ '^[+]1[2-9][0-9]{9}$');
alter table public.sms_contact_consents drop constraint sms_contact_consents_phone_e164_check;
alter table public.sms_contact_consents add constraint sms_contact_consents_phone_e164_check
  check (phone_e164 ~ '^[+]1[2-9][0-9]{9}$');
alter table public.sms_suppressions drop constraint sms_suppressions_phone_e164_check;
alter table public.sms_suppressions add constraint sms_suppressions_phone_e164_check
  check (phone_e164 ~ '^[+]1[2-9][0-9]{9}$');
alter table public.sms_audience_snapshot_recipients drop constraint sms_audience_snapshot_recipients_phone_e164_check;
alter table public.sms_audience_snapshot_recipients add constraint sms_audience_snapshot_recipients_phone_e164_check
  check (phone_e164 ~ '^[+]1[2-9][0-9]{9}$');
