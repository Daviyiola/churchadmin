create table public.communication_audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  criteria jsonb not null default '{}'::jsonb,
  source_counts jsonb not null default '{}'::jsonb,
  total_recipients integer not null default 0,
  invalid_count integer not null default 0,
  duplicate_count integer not null default 0,
  campaign_id uuid unique references public.communication_campaigns(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint communication_audience_snapshots_criteria_object check (jsonb_typeof(criteria) = 'object'),
  constraint communication_audience_snapshots_counts_object check (jsonb_typeof(source_counts) = 'object'),
  constraint communication_audience_snapshots_total_check check (total_recipients between 0 and 10000),
  constraint communication_audience_snapshots_invalid_check check (invalid_count >= 0),
  constraint communication_audience_snapshots_duplicate_check check (duplicate_count >= 0)
);

create table public.communication_audience_snapshot_recipients (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.communication_audience_snapshots(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  email_norm text generated always as (lower(btrim(email))) stored,
  display_name text,
  source_types text[] not null default '{}'::text[],
  source_labels text[] not null default '{}'::text[],
  processed_at timestamptz,
  success boolean,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint communication_audience_snapshot_recipients_email_check
    check (char_length(btrim(email)) between 3 and 254),
  constraint communication_audience_snapshot_recipients_snapshot_email_unique
    unique (snapshot_id, email_norm)
);

create index communication_audience_snapshots_actor_expiry_idx
  on public.communication_audience_snapshots (org_id, created_by, expires_at desc);
create index communication_audience_snapshot_recipients_snapshot_idx
  on public.communication_audience_snapshot_recipients (snapshot_id, created_at, id);
create index communication_audience_snapshot_recipients_org_idx
  on public.communication_audience_snapshot_recipients (org_id, snapshot_id);

alter table public.communication_audience_snapshots enable row level security;
alter table public.communication_audience_snapshot_recipients enable row level security;

revoke all on table public.communication_audience_snapshots from public, anon, authenticated;
revoke all on table public.communication_audience_snapshot_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.communication_audience_snapshots to service_role;
grant select, insert, update, delete on table public.communication_audience_snapshot_recipients to service_role;

comment on table public.communication_audience_snapshots is
  'Short-lived server-resolved recipient selections for communication broadcasts.';
comment on table public.communication_audience_snapshot_recipients is
  'Deduplicated recipients resolved by the server; never writable by ordinary clients.';
