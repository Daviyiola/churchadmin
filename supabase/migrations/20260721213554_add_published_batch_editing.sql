-- Published income/attendance batch metadata editing.
-- Parent batch/session rows are the source of truth for service and date.

-- Repair legacy income ledger rows before enforcing the synchronized workflow.
update public.income_entries e
set service_category_id = b.service_category_id,
    session_date = b.session_date
from public.income_draft_batches b
where e.batch_id = b.id
  and e.org_id = b.org_id
  and (
    e.service_category_id is distinct from b.service_category_id
    or e.session_date is distinct from b.session_date
  );

alter table public.income_draft_batches
  add column if not exists revision integer not null default 0,
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by uuid,
  add column if not exists last_edited_by_email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'income_draft_batches_service_category_id_fkey'
      and conrelid = 'public.income_draft_batches'::regclass
  ) then
    alter table public.income_draft_batches
      add constraint income_draft_batches_service_category_id_fkey
      foreign key (service_category_id)
      references public.categories(id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.income_draft_batches
  validate constraint income_draft_batches_service_category_id_fkey;

create table if not exists public.income_batch_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.income_draft_batches(id) on delete cascade,
  revision integer not null check (revision > 0),
  old_service_category_id uuid not null references public.categories(id) on delete restrict,
  new_service_category_id uuid not null references public.categories(id) on delete restrict,
  old_service_name text not null,
  new_service_name text not null,
  old_session_date date not null,
  new_session_date date not null,
  edited_by uuid not null,
  edited_by_email text,
  edited_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  constraint income_batch_edits_has_change check (
    old_service_category_id is distinct from new_service_category_id
    or old_session_date is distinct from new_session_date
  ),
  constraint income_batch_edits_batch_revision_key unique (batch_id, revision)
);

create index if not exists income_batch_edits_org_batch_time_idx
  on public.income_batch_edits (org_id, batch_id, edited_at desc);

alter table public.income_batch_edits enable row level security;

drop policy if exists income_batch_edits_select_org
  on public.income_batch_edits;
create policy income_batch_edits_select_org
  on public.income_batch_edits
  for select
  to authenticated
  using ((select public.is_org_member(org_id)));

revoke all on table public.income_batch_edits from public, anon, authenticated;
grant select on table public.income_batch_edits to authenticated;

create table if not exists public.attendance_session_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  revision integer not null check (revision > 0),
  old_service_category_id uuid not null references public.categories(id) on delete restrict,
  new_service_category_id uuid not null references public.categories(id) on delete restrict,
  old_service_name text not null,
  new_service_name text not null,
  old_session_date date not null,
  new_session_date date not null,
  edited_by uuid not null,
  edited_by_email text,
  edited_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  constraint attendance_session_edits_has_change check (
    old_service_category_id is distinct from new_service_category_id
    or old_session_date is distinct from new_session_date
  ),
  constraint attendance_session_edits_session_revision_key
    unique (session_id, revision)
);

create index if not exists attendance_session_edits_org_session_time_idx
  on public.attendance_session_edits (org_id, session_id, edited_at desc);

alter table public.attendance_session_edits enable row level security;

drop policy if exists attendance_session_edits_select_org
  on public.attendance_session_edits;
create policy attendance_session_edits_select_org
  on public.attendance_session_edits
  for select
  to authenticated
  using ((select public.is_org_member(org_id)));

revoke all on table public.attendance_session_edits
  from public, anon, authenticated;
grant select on table public.attendance_session_edits to authenticated;

create or replace function public.edit_published_income_batch(
  p_batch_id uuid,
  p_service_category_id uuid,
  p_session_date date,
  p_reason text
)
returns table (
  id uuid,
  service_category_id uuid,
  session_date date,
  revision integer,
  last_edited_at timestamptz,
  last_edited_by_email text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.income_draft_batches%rowtype;
  v_old_service_name text;
  v_new_service_name text;
  v_editor_email text;
  v_revision integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_service_category_id is null or p_session_date is null then
    raise exception 'Service and date are required';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'Reason is required';
  end if;

  select b.*
  into v_batch
  from public.income_draft_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'Published income batch not found';
  end if;

  if v_batch.status <> 'published' then
    raise exception 'Only published income batches can be edited';
  end if;

  if not public.is_org_finance(v_batch.org_id) then
    raise exception 'Finance, admin, or owner role required';
  end if;

  select c.name
  into v_new_service_name
  from public.categories c
  where c.id = p_service_category_id
    and c.org_id = v_batch.org_id
    and c.type = 'services'
    and c.status = 'active';

  if not found then
    raise exception 'Select an active service from this organization';
  end if;

  if v_batch.service_category_id = p_service_category_id
     and v_batch.session_date = p_session_date then
    raise exception 'Change the service or date before saving';
  end if;

  select c.name
  into v_old_service_name
  from public.categories c
  where c.id = v_batch.service_category_id;

  select coalesce(
    (select p.email from public.profiles p where p.id = auth.uid()),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '')
  )
  into v_editor_email;

  v_revision := v_batch.revision + 1;

  update public.income_draft_batches b
  set service_category_id = p_service_category_id,
      session_date = p_session_date,
      revision = v_revision,
      last_edited_at = now(),
      last_edited_by = auth.uid(),
      last_edited_by_email = v_editor_email
  where b.id = v_batch.id;

  update public.income_entries e
  set service_category_id = p_service_category_id,
      session_date = p_session_date
  where e.org_id = v_batch.org_id
    and e.batch_id = v_batch.id;

  insert into public.income_batch_edits (
    org_id,
    batch_id,
    revision,
    old_service_category_id,
    new_service_category_id,
    old_service_name,
    new_service_name,
    old_session_date,
    new_session_date,
    edited_by,
    edited_by_email,
    reason
  ) values (
    v_batch.org_id,
    v_batch.id,
    v_revision,
    v_batch.service_category_id,
    p_service_category_id,
    v_old_service_name,
    v_new_service_name,
    v_batch.session_date,
    p_session_date,
    auth.uid(),
    v_editor_email,
    btrim(p_reason)
  );

  return query
  select b.id,
         b.service_category_id,
         b.session_date,
         b.revision,
         b.last_edited_at,
         b.last_edited_by_email
  from public.income_draft_batches b
  where b.id = v_batch.id;
end
$$;

revoke all on function public.edit_published_income_batch(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.edit_published_income_batch(uuid, uuid, date, text)
  to authenticated;

create or replace function public.edit_published_attendance_session(
  p_session_id uuid,
  p_service_category_id uuid,
  p_session_date date,
  p_reason text
)
returns table (
  id uuid,
  service_category_id uuid,
  session_date date,
  revision integer,
  last_edited_at timestamptz,
  last_edited_by_email text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_old_service_name text;
  v_new_service_name text;
  v_editor_email text;
  v_revision integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_service_category_id is null or p_session_date is null then
    raise exception 'Service and date are required';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'Reason is required';
  end if;

  select s.*
  into v_session
  from public.attendance_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'Published attendance session not found';
  end if;

  if v_session.status <> 'published' then
    raise exception 'Only published attendance sessions can be edited';
  end if;

  if v_session.deleted_at is not null then
    raise exception 'Deleted attendance sessions cannot be edited';
  end if;

  if not public.is_org_finance(v_session.org_id) then
    raise exception 'Finance, admin, or owner role required';
  end if;

  select c.name
  into v_new_service_name
  from public.categories c
  where c.id = p_service_category_id
    and c.org_id = v_session.org_id
    and c.type = 'services'
    and c.status = 'active';

  if not found then
    raise exception 'Select an active service from this organization';
  end if;

  if v_session.service_category_id = p_service_category_id
     and v_session.session_date = p_session_date then
    raise exception 'Change the service or date before saving';
  end if;

  select c.name
  into v_old_service_name
  from public.categories c
  where c.id = v_session.service_category_id;

  select coalesce(
    (select p.email from public.profiles p where p.id = auth.uid()),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '')
  )
  into v_editor_email;

  v_revision := v_session.revision + 1;

  update public.attendance_sessions s
  set service_category_id = p_service_category_id,
      session_date = p_session_date,
      revision = v_revision,
      last_edited_at = now(),
      last_edited_by = auth.uid(),
      last_edited_by_email = v_editor_email
  where s.id = v_session.id;

  update public.attendance_entries e
  set service_category_id = p_service_category_id,
      session_date = p_session_date
  where e.org_id = v_session.org_id
    and e.session_id = v_session.id;

  insert into public.attendance_session_edits (
    org_id,
    session_id,
    revision,
    old_service_category_id,
    new_service_category_id,
    old_service_name,
    new_service_name,
    old_session_date,
    new_session_date,
    edited_by,
    edited_by_email,
    reason
  ) values (
    v_session.org_id,
    v_session.id,
    v_revision,
    v_session.service_category_id,
    p_service_category_id,
    v_old_service_name,
    v_new_service_name,
    v_session.session_date,
    p_session_date,
    auth.uid(),
    v_editor_email,
    btrim(p_reason)
  );

  return query
  select s.id,
         s.service_category_id,
         s.session_date,
         s.revision,
         s.last_edited_at,
         s.last_edited_by_email
  from public.attendance_sessions s
  where s.id = v_session.id;
end
$$;

revoke all on function public.edit_published_attendance_session(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.edit_published_attendance_session(uuid, uuid, date, text)
  to authenticated;
