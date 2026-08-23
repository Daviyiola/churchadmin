create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  org_id uuid not null,
  form_revision integer not null,
  request_id uuid not null,
  status text not null default 'new',
  form_snapshot jsonb not null,
  answers jsonb not null,
  result_member_id uuid references public.members(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  constraint form_submissions_form_org_fk foreign key (form_id, org_id)
    references public.forms(id, org_id) on delete restrict,
  constraint form_submissions_form_revision_fk foreign key (form_id, form_revision)
    references public.form_revisions(form_id, revision) on delete restrict,
  constraint form_submissions_id_form_org_unique unique (id, form_id, org_id),
  constraint form_submissions_request_unique unique (form_id, request_id),
  constraint form_submissions_status_check check (status in ('new', 'reviewed', 'archived')),
  constraint form_submissions_snapshot_object_check check (jsonb_typeof(form_snapshot) = 'object'),
  constraint form_submissions_answers_object_check check (jsonb_typeof(answers) = 'object'),
  constraint form_submissions_answers_size_check check (pg_column_size(answers) <= 65536)
);

create table public.form_submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null,
  form_id uuid not null,
  org_id uuid not null,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint form_submission_events_submission_fk
    foreign key (submission_id, form_id, org_id)
    references public.form_submissions(id, form_id, org_id) on delete cascade,
  constraint form_submission_events_action_check
    check (action in ('submitted', 'reviewed', 'archived', 'reopened'))
);

create table private.form_field_integrations (
  form_id uuid not null references public.forms(id) on delete cascade,
  field_key uuid not null,
  integration_key text not null,
  primary key (form_id, field_key),
  constraint form_field_integrations_key_unique unique (form_id, integration_key),
  constraint form_field_integrations_key_check check (integration_key in (
    'first_name', 'last_name', 'gender', 'age_group', 'email', 'phone',
    'address', 'marital_status', 'children_count', 'how_heard', 'prayer_requests'
  ))
);

insert into private.form_field_integrations (form_id, field_key, integration_key)
select ff.form_id, ff.field_key,
  case pg_catalog.lower(ff.label)
    when 'first name' then 'first_name'
    when 'last name' then 'last_name'
    when 'gender' then 'gender'
    when 'age group' then 'age_group'
    when 'email' then 'email'
    when 'phone' then 'phone'
    when 'home address' then 'address'
    when 'marital status' then 'marital_status'
    when 'children count' then 'children_count'
    when 'how did you hear about us?' then 'how_heard'
    when 'prayer requests' then 'prayer_requests'
  end
from public.form_fields ff
join public.forms f on f.id = ff.form_id
where f.form_kind = 'first_timer'
  and pg_catalog.lower(ff.label) in (
    'first name', 'last name', 'gender', 'age group', 'email', 'phone',
    'home address', 'marital status', 'children count',
    'how did you hear about us?', 'prayer requests'
  )
on conflict do nothing;

create index form_submissions_org_form_submitted_idx
  on public.form_submissions (org_id, form_id, submitted_at desc);
create index form_submissions_org_form_status_submitted_idx
  on public.form_submissions (org_id, form_id, status, submitted_at desc);
create index form_submissions_result_member_idx
  on public.form_submissions (result_member_id) where result_member_id is not null;
create index form_submissions_reviewed_by_idx
  on public.form_submissions (reviewed_by) where reviewed_by is not null;
create index form_submissions_archived_by_idx
  on public.form_submissions (archived_by) where archived_by is not null;
create index form_submission_events_submission_created_idx
  on public.form_submission_events (submission_id, created_at desc);
create index form_submission_events_org_form_created_idx
  on public.form_submission_events (org_id, form_id, created_at desc);
create index form_submission_events_actor_idx
  on public.form_submission_events (actor_id) where actor_id is not null;

alter table public.form_submissions enable row level security;
alter table public.form_submission_events enable row level security;
alter table private.form_field_integrations enable row level security;

revoke all on table public.form_submissions from public, anon, authenticated;
revoke all on table public.form_submission_events from public, anon, authenticated;
revoke all on table private.form_field_integrations from public, anon, authenticated;
grant select on table public.form_submissions to authenticated;
grant select on table public.form_submission_events to authenticated;
grant select, insert, update, delete on table public.form_submissions to service_role;
grant select, insert, update, delete on table public.form_submission_events to service_role;
grant select, insert, update, delete on table private.form_field_integrations to service_role;

create policy form_submissions_select_managers
on public.form_submissions for select to authenticated
using ((select public.is_org_finance(org_id)));

create policy form_submission_events_select_managers
on public.form_submission_events for select to authenticated
using ((select public.is_org_finance(org_id)));

create or replace function public.sync_first_timer_field_integration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not exists (
    select 1 from public.forms f
    where f.id = new.form_id and f.form_kind = 'first_timer'
  ) then return new; end if;

  v_key := case pg_catalog.lower(new.label)
    when 'first name' then 'first_name'
    when 'last name' then 'last_name'
    when 'gender' then 'gender'
    when 'age group' then 'age_group'
    when 'email' then 'email'
    when 'phone' then 'phone'
    when 'home address' then 'address'
    when 'marital status' then 'marital_status'
    when 'children count' then 'children_count'
    when 'how did you hear about us?' then 'how_heard'
    when 'prayer requests' then 'prayer_requests'
    else null
  end;

  if v_key is not null then
    insert into private.form_field_integrations (form_id, field_key, integration_key)
    values (new.form_id, new.field_key, v_key)
    on conflict (form_id, field_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger form_fields_sync_first_timer_integration
after insert on public.form_fields
for each row execute function public.sync_first_timer_field_integration();

create or replace function public.submit_public_form(
  p_slug text,
  p_request_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_field public.form_fields%rowtype;
  v_answer jsonb;
  v_text text;
  v_snapshot jsonb;
  v_submission_id uuid := gen_random_uuid();
  v_member_id uuid;
  v_first_name text;
  v_last_name text;
  v_gender text;
  v_age_group text;
  v_email text;
  v_phone text;
  v_address text;
  v_marital_status text;
  v_children_text text;
  v_children_count integer;
  v_how_heard text;
  v_prayer_requests text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing uuid;
begin
  if p_request_id is null
     or nullif(pg_catalog.btrim(coalesce(p_slug, '')), '') is null
     or p_answers is null
     or jsonb_typeof(p_answers) <> 'object'
     or pg_column_size(p_answers) > 65536 then
    raise exception 'FORM_INVALID_SUBMISSION';
  end if;

  select * into v_form
  from public.forms f
  where f.slug = p_slug
  for update;

  if v_form.id is null then raise exception 'FORM_NOT_FOUND'; end if;
  if v_form.status <> 'open' then raise exception 'FORM_NOT_ACTIVE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_form.id::text || ':' || p_request_id::text)
  );

  select fs.id into v_existing
  from public.form_submissions fs
  where fs.form_id = v_form.id and fs.request_id = p_request_id;
  if v_existing is not null then
    return pg_catalog.jsonb_build_object(
      'submission_id', v_existing,
      'idempotent', true
    );
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_answers) supplied(key)
    where not exists (
      select 1 from public.form_fields ff
      where ff.form_id = v_form.id and ff.field_key::text = supplied.key
    )
  ) then raise exception 'FORM_INVALID_SUBMISSION'; end if;

  for v_field in
    select * from public.form_fields ff
    where ff.form_id = v_form.id order by ff.position
  loop
    v_answer := p_answers -> v_field.field_key::text;
    if v_answer is null or v_answer = 'null'::jsonb then
      if v_field.is_required then raise exception 'FORM_REQUIRED_FIELD'; end if;
      continue;
    end if;

    if v_field.field_type = 'multiple_choice' then
      if jsonb_typeof(v_answer) <> 'array'
         or jsonb_array_length(v_answer) > 50
         or (v_field.is_required and jsonb_array_length(v_answer) = 0)
         or exists (
           select 1 from jsonb_array_elements(v_answer) selected(value)
           where jsonb_typeof(selected.value) <> 'string'
              or not (v_field.options @> pg_catalog.jsonb_build_array(selected.value))
         ) then raise exception 'FORM_INVALID_FIELD'; end if;
    else
      if jsonb_typeof(v_answer) <> 'string' then raise exception 'FORM_INVALID_FIELD'; end if;
      v_text := pg_catalog.btrim(v_answer #>> '{}');
      if v_field.is_required and v_text = '' then raise exception 'FORM_REQUIRED_FIELD'; end if;
      if char_length(v_text) > (case when v_field.field_type = 'long_text' then 5000 else 1000 end) then
        raise exception 'FORM_INVALID_FIELD';
      end if;
      if v_text <> '' and v_field.field_type = 'email'
         and v_text !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'FORM_INVALID_FIELD';
      end if;
      if v_text <> '' and v_field.field_type = 'number'
         and v_text !~ '^-?[0-9]+([.][0-9]+)?$' then raise exception 'FORM_INVALID_FIELD'; end if;
      if v_text <> '' and v_field.field_type = 'date'
         and v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'FORM_INVALID_FIELD'; end if;
      if v_text <> '' and v_field.field_type in ('single_choice', 'dropdown')
         and not (v_field.options @> pg_catalog.jsonb_build_array(v_text)) then
        raise exception 'FORM_INVALID_FIELD';
      end if;
      if v_text <> '' and v_field.field_type = 'yes_no'
         and v_text not in ('yes', 'no') then raise exception 'FORM_INVALID_FIELD'; end if;
    end if;
  end loop;

  select pg_catalog.jsonb_build_object(
    'title', v_form.title,
    'description', v_form.description,
    'revision', v_form.revision,
    'fields', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'key', ff.field_key, 'type', ff.field_type, 'label', ff.label,
      'help_text', ff.help_text, 'placeholder', ff.placeholder,
      'required', ff.is_required, 'options', ff.options,
      'width', ff.layout_width, 'locked', ff.is_locked
    ) order by ff.position), '[]'::jsonb)
  ) into v_snapshot
  from public.form_fields ff where ff.form_id = v_form.id;

  if v_form.form_kind = 'first_timer' then
    select
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'first_name'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'last_name'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'gender'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'age_group'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'email'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'phone'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'address'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'marital_status'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'children_count'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'how_heard'),
      max(p_answers->>i.field_key::text) filter (where i.integration_key = 'prayer_requests')
    into v_first_name, v_last_name, v_gender, v_age_group, v_email, v_phone,
      v_address, v_marital_status, v_children_text, v_how_heard, v_prayer_requests
    from private.form_field_integrations i
    join public.form_fields ff on ff.form_id = i.form_id and ff.field_key = i.field_key
    where i.form_id = v_form.id;

    v_first_name := pg_catalog.btrim(coalesce(v_first_name, ''));
    v_last_name := pg_catalog.btrim(coalesce(v_last_name, ''));
    v_gender := pg_catalog.lower(pg_catalog.btrim(coalesce(v_gender, '')));
    v_age_group := pg_catalog.btrim(coalesce(v_age_group, ''));
    v_email := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_email, ''))), '');
    v_phone := nullif(pg_catalog.btrim(coalesce(v_phone, '')), '');
    v_children_text := nullif(pg_catalog.btrim(coalesce(v_children_text, '')), '');

    if v_first_name = '' or v_last_name = ''
       or v_gender not in ('male', 'female')
       or v_age_group not in ('1-12', '13-17', '18-35', '36+')
       or (v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
       or (v_children_text is not null and v_children_text !~ '^[0-9]+$') then
      raise exception 'FORM_FIRST_TIMER_INVALID';
    end if;
    v_children_count := case when v_children_text is null then null else v_children_text::integer end;
    if v_children_count is not null and v_children_count > 100 then
      raise exception 'FORM_FIRST_TIMER_INVALID';
    end if;

    insert into public.members (
      org_id, membership_stage, profile_complete, first_name, last_name,
      email, phone, gender, age_group, segment, address, marital_status,
      children_count, status, created_at, updated_at
    ) values (
      v_form.org_id, 'visitor', v_phone is not null,
      v_first_name, v_last_name, v_email, v_phone, v_gender, v_age_group,
      public.compute_segment(v_gender, v_age_group),
      nullif(pg_catalog.btrim(coalesce(v_address, '')), ''),
      nullif(pg_catalog.btrim(coalesce(v_marital_status, '')), ''),
      v_children_count, 'active', v_now, v_now
    ) returning id into v_member_id;

    insert into public.visitor_details (
      member_id, first_visit_at, follow_up_status, how_heard,
      prayer_request_tags, next_follow_up_at, updated_at
    ) values (
      v_member_id, v_now::date, 'new',
      nullif(pg_catalog.btrim(coalesce(v_how_heard, '')), ''),
      case when nullif(pg_catalog.btrim(coalesce(v_prayer_requests, '')), '') is null
        then null else array[pg_catalog.btrim(v_prayer_requests)] end,
      v_now::date + 3, v_now
    );

    perform private.schedule_intake_followups(
      v_form.org_id, v_member_id, v_first_name, v_last_name, v_email, v_now::date
    );
  end if;

  insert into public.form_submissions (
    id, form_id, org_id, form_revision, request_id, status,
    form_snapshot, answers, result_member_id, submitted_at,
    reviewed_at
  ) values (
    v_submission_id, v_form.id, v_form.org_id, v_form.revision, p_request_id,
    case when v_form.form_kind = 'first_timer' then 'reviewed' else 'new' end,
    v_snapshot, p_answers, v_member_id, v_now,
    case when v_form.form_kind = 'first_timer' then v_now else null end
  );

  insert into public.form_submission_events (
    submission_id, form_id, org_id, action
  ) values (v_submission_id, v_form.id, v_form.org_id, 'submitted');

  return pg_catalog.jsonb_build_object(
    'submission_id', v_submission_id,
    'visitor_created', v_member_id is not null,
    'idempotent', false
  );
end;
$$;

create or replace function public.set_form_submission_status(
  p_submission_id uuid,
  p_actor_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.form_submissions%rowtype;
  v_action text;
begin
  select * into v_submission from public.form_submissions s
  where s.id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_submission.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;
  if p_status not in ('new', 'reviewed', 'archived') or p_status = v_submission.status then
    raise exception 'Invalid submission status';
  end if;

  v_action := case when p_status = 'archived' then 'archived'
    when p_status = 'reviewed' then 'reviewed' else 'reopened' end;
  update public.form_submissions
  set status = p_status,
      reviewed_at = case when p_status = 'new' then null else coalesce(reviewed_at, pg_catalog.clock_timestamp()) end,
      reviewed_by = case when p_status = 'new' then null else coalesce(reviewed_by, p_actor_id) end,
      archived_at = case when p_status = 'archived' then pg_catalog.clock_timestamp() else null end,
      archived_by = case when p_status = 'archived' then p_actor_id else null end
  where id = p_submission_id;

  insert into public.form_submission_events (
    submission_id, form_id, org_id, action, actor_id
  ) values (p_submission_id, v_submission.form_id, v_submission.org_id, v_action, p_actor_id);
  return p_status;
end;
$$;

create or replace function public.delete_empty_managed_form(
  p_form_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
begin
  select * into v_form from public.forms f where f.id = p_form_id for update;
  if v_form.id is null then raise exception 'Form not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_form.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;
  if v_form.is_system then raise exception 'Built-in forms cannot be deleted'; end if;
  if v_form.status = 'open' then raise exception 'Close the form before deleting it'; end if;
  if exists (select 1 from public.form_submissions s where s.form_id = p_form_id) then
    raise exception 'FORM_HAS_SUBMISSIONS';
  end if;
  delete from public.forms where id = p_form_id;
end;
$$;

revoke all on function public.sync_first_timer_field_integration()
  from public, anon, authenticated, service_role;
revoke all on function public.submit_public_form(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.set_form_submission_status(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_empty_managed_form(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_public_form(text, uuid, jsonb) to service_role;
grant execute on function public.set_form_submission_status(uuid, uuid, text) to service_role;
grant execute on function public.delete_empty_managed_form(uuid, uuid) to service_role;
