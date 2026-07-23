-- Repair the one legacy income row whose batch_id crossed organizations.
-- Its organization, member, income category, service, and date all match the
-- replacement batch below.
update public.income_entries
set batch_id = '5a81d667-97e2-47c5-ae2f-0ce8f90a15e2'::uuid
where id = 'dad3b55a-0c9c-4aa5-b5a3-ee9586abd272'::uuid
  and batch_id = '049d2eaf-8307-456d-b948-987f2316533f'::uuid
  and org_id = 'ed689d67-d980-46e8-a336-10fdc7c8c193'::uuid
  and service_category_id = '80f05665-14c3-401d-9141-ec1e404ca8df'::uuid
  and session_date = '2026-01-01'::date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_draft_batches_id_org_key'
      and conrelid = 'public.income_draft_batches'::regclass
  ) then
    alter table public.income_draft_batches
      add constraint income_draft_batches_id_org_key unique (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_entries_batch_org_fkey'
      and conrelid = 'public.income_entries'::regclass
  ) then
    alter table public.income_entries
      add constraint income_entries_batch_org_fkey
      foreign key (batch_id, org_id)
      references public.income_draft_batches(id, org_id)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_sessions_id_org_key'
      and conrelid = 'public.attendance_sessions'::regclass
  ) then
    alter table public.attendance_sessions
      add constraint attendance_sessions_id_org_key unique (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_entries_session_org_fkey'
      and conrelid = 'public.attendance_entries'::regclass
  ) then
    alter table public.attendance_entries
      add constraint attendance_entries_session_org_fkey
      foreign key (session_id, org_id)
      references public.attendance_sessions(id, org_id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.income_entries
  validate constraint income_entries_batch_org_fkey;

alter table public.attendance_entries
  validate constraint attendance_entries_session_org_fkey;
