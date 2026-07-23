begin;

alter table public.organization_settings
  add column if not exists timezone_name text,
  add column if not exists timezone_confirmed boolean not null default false,
  add column if not exists nikky_enabled boolean not null default false,
  add column if not exists nikky_monthly_budget_cents integer;

alter table public.organization_settings
  drop constraint if exists organization_settings_nikky_budget_positive;
alter table public.organization_settings
  add constraint organization_settings_nikky_budget_positive
  check (nikky_monthly_budget_cents is null or nikky_monthly_budget_cents > 0);

update public.organization_settings os
set timezone_name = fs.timezone_name,
    timezone_confirmed = true
from public.followup_settings fs
where fs.org_id = os.organization_id
  and os.timezone_name is null
  and fs.timezone_name in (select name from pg_catalog.pg_timezone_names);

create or replace function public.validate_organization_timezone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.timezone_name is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone_name
  ) then
    raise exception 'Invalid IANA timezone: %', new.timezone_name;
  end if;
  if new.nikky_enabled and (new.timezone_name is null or not new.timezone_confirmed) then
    raise exception 'A confirmed organization timezone is required before Nikky can be enabled.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_organization_timezone() from public, anon, authenticated;

drop trigger if exists organization_settings_validate_timezone on public.organization_settings;
create trigger organization_settings_validate_timezone
before insert or update of timezone_name, timezone_confirmed, nikky_enabled
on public.organization_settings
for each row execute function public.validate_organization_timezone();

create table public.nikky_user_contexts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  selected_at timestamptz not null default now(),
  constraint nikky_user_context_membership_fk
    foreign key (user_id, organization_id)
    references public.user_organizations(user_id, organization_id)
    on delete cascade
);
alter table public.nikky_user_contexts enable row level security;
revoke all on table public.nikky_user_contexts from public, anon;
grant select on table public.nikky_user_contexts to authenticated;
create policy nikky_user_contexts_select_own
on public.nikky_user_contexts for select to authenticated
using ((select auth.uid()) = user_id);

create table public.nikky_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  context_summary text,
  summary_through_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nikky_conversations_user_org_updated_idx
on public.nikky_conversations(user_id, organization_id, updated_at desc);
alter table public.nikky_conversations enable row level security;
revoke all on table public.nikky_conversations from public, anon;
grant select, update, delete on table public.nikky_conversations to authenticated;
create policy nikky_conversations_select_own
on public.nikky_conversations for select to authenticated
using (
  user_id = (select auth.uid())
  and public.is_org_finance(organization_id)
);
create policy nikky_conversations_update_own
on public.nikky_conversations for update to authenticated
using (user_id = (select auth.uid()) and public.is_org_finance(organization_id))
with check (user_id = (select auth.uid()) and public.is_org_finance(organization_id));
create policy nikky_conversations_delete_own
on public.nikky_conversations for delete to authenticated
using (user_id = (select auth.uid()) and public.is_org_finance(organization_id));

create table public.nikky_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nikky_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 20000),
  status text not null default 'complete' check (status in ('pending','complete','failed')),
  evidence_ids text[] not null default '{}',
  model text,
  created_at timestamptz not null default now()
);
alter table public.nikky_conversations
  add constraint nikky_conversations_summary_message_fk
  foreign key (summary_through_message_id) references public.nikky_messages(id) on delete set null;
create index nikky_messages_conversation_created_idx
on public.nikky_messages(conversation_id, created_at, id);
alter table public.nikky_messages enable row level security;
revoke all on table public.nikky_messages from public, anon;
grant select on table public.nikky_messages to authenticated;
create policy nikky_messages_select_own
on public.nikky_messages for select to authenticated
using (
  user_id = (select auth.uid())
  and public.is_org_finance(organization_id)
  and exists (
    select 1 from public.nikky_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  )
);

create table public.nikky_report_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.nikky_conversations(id) on delete set null,
  report_type text not null,
  format text not null check (format in ('pdf','csv')),
  filename text not null,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','generating','ready','failed','expired')),
  record_count integer check (record_count is null or record_count >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index nikky_report_artifacts_user_org_created_idx
on public.nikky_report_artifacts(user_id, organization_id, created_at desc);
alter table public.nikky_report_artifacts enable row level security;
revoke all on table public.nikky_report_artifacts from public, anon;
grant select on table public.nikky_report_artifacts to authenticated;
create policy nikky_report_artifacts_select_own
on public.nikky_report_artifacts for select to authenticated
using (user_id = (select auth.uid()) and public.is_org_finance(organization_id));

create table public.nikky_report_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.nikky_conversations(id) on delete cascade,
  role_snapshot text not null check (role_snapshot in ('owner','admin','finance')),
  report_type text not null,
  format text not null check (format in ('pdf','csv')),
  canonical_parameters jsonb not null,
  parameters_hash text not null,
  access_classification text not null,
  status text not null default 'pending' check (status in ('pending','executing','complete','failed','expired')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  artifact_id uuid references public.nikky_report_artifacts(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  executed_at timestamptz
);
create index nikky_report_confirmations_user_status_idx
on public.nikky_report_confirmations(user_id, status, expires_at);
alter table public.nikky_report_confirmations enable row level security;
revoke all on table public.nikky_report_confirmations from public, anon;
grant select on table public.nikky_report_confirmations to authenticated;
create policy nikky_report_confirmations_select_own
on public.nikky_report_confirmations for select to authenticated
using (user_id = (select auth.uid()) and public.is_org_finance(organization_id));

create table public.nikky_audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role_snapshot text not null,
  conversation_id uuid,
  tool_name text,
  report_type text,
  confirmation_id uuid,
  artifact_id uuid,
  requested_parameters jsonb not null default '{}'::jsonb,
  applied_parameters jsonb not null default '{}'::jsonb,
  authorization_outcome text not null,
  outcome text not null,
  error_code text,
  access_classifications text[] not null default '{}',
  record_count integer,
  duration_ms integer,
  model text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  estimated_cost_micros bigint,
  member_reference_hmac text,
  request_id uuid not null default gen_random_uuid()
);
create index nikky_audit_logs_org_occurred_idx
on public.nikky_audit_logs(organization_id, occurred_at desc);
create index nikky_audit_logs_expiry_idx on public.nikky_audit_logs(occurred_at);
alter table public.nikky_audit_logs enable row level security;
revoke all on table public.nikky_audit_logs from public, anon, authenticated;

create or replace function public.guard_nikky_audit_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Nikky audit records are append-only.';
  end if;
  if tg_op = 'DELETE' and current_user not in ('postgres', 'service_role') then
    raise exception 'Nikky audit records cannot be deleted by application users.';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_nikky_audit_immutability() from public, anon, authenticated;
create trigger nikky_audit_immutable
before update or delete on public.nikky_audit_logs
for each row execute function public.guard_nikky_audit_immutability();

create table public.nikky_usage_monthly (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  request_count integer not null default 0,
  tool_call_count integer not null default 0,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_micros bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, usage_month),
  check (usage_month = date_trunc('month', usage_month)::date)
);
alter table public.nikky_usage_monthly enable row level security;
revoke all on table public.nikky_usage_monthly from public, anon, authenticated;

create table public.nikky_rate_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('chat','report','request_start','request_end')),
  occurred_at timestamptz not null default now()
);
create index nikky_rate_events_user_type_time_idx
on public.nikky_rate_events(user_id, event_type, occurred_at desc);
create index nikky_rate_events_org_type_time_idx
on public.nikky_rate_events(organization_id, event_type, occurred_at desc);
alter table public.nikky_rate_events enable row level security;
revoke all on table public.nikky_rate_events from public, anon, authenticated;

commit;
