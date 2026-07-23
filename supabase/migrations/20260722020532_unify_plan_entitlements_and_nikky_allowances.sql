begin;

create table public.plan_entitlements (
  plan_key text primary key check (plan_key in ('free','basic','pro','enterprise')),
  email_monthly_limit integer not null check (email_monthly_limit >= 0),
  nikky_monthly_budget_cents integer check (nikky_monthly_budget_cents is null or nikky_monthly_budget_cents > 0),
  updated_at timestamptz not null default now(),
  check (plan_key = 'enterprise' or nikky_monthly_budget_cents is not null)
);

comment on column public.plan_entitlements.nikky_monthly_budget_cents is
  'Internal Church Admin OpenAI-cost safety cap. Never present this amount as customer credit.';

insert into public.plan_entitlements(plan_key,email_monthly_limit,nikky_monthly_budget_cents)
values
  ('free',100,50),
  ('basic',1000,300),
  ('pro',3000,800),
  ('enterprise',10000,null);

alter table public.plan_entitlements enable row level security;
revoke all on table public.plan_entitlements from public,anon,authenticated;

-- Preserve the pre-migration value so this bulk plan normalization can be
-- reviewed or reversed without relying on external notes.
create table public.organization_plan_migration_backup (
  migration_key text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  previous_plan text,
  captured_at timestamptz not null default now(),
  primary key (migration_key,organization_id)
);
alter table public.organization_plan_migration_backup enable row level security;
revoke all on table public.organization_plan_migration_backup from public,anon,authenticated;

insert into public.organization_plan_migration_backup(migration_key,organization_id,previous_plan)
select 'unify_plan_entitlements_20260722',organization_id,plan
from public.org_plans
on conflict do nothing;

update public.org_plans set plan='pro',updated_at=now();
alter table public.org_plans alter column plan set default 'basic';

commit;
