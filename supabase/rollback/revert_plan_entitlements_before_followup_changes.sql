begin;

update public.org_plans op
set plan=backup.previous_plan,updated_at=now()
from public.organization_plan_migration_backup backup
where backup.migration_key='unify_plan_entitlements_20260722'
  and backup.organization_id=op.organization_id;

drop table if exists public.plan_entitlements;
alter table public.org_plans alter column plan drop default;

commit;
