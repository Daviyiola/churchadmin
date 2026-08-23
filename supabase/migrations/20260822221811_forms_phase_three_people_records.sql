create table public.person_custom_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  field_type text not null,
  options jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_custom_fields_id_org_unique unique (id, org_id),
  constraint person_custom_fields_name_check check (char_length(btrim(name)) between 1 and 160),
  constraint person_custom_fields_type_check check (field_type in (
    'short_text', 'long_text', 'email', 'phone', 'number', 'date',
    'single_choice', 'multiple_choice', 'dropdown', 'yes_no'
  )),
  constraint person_custom_fields_status_check check (status in ('active', 'archived')),
  constraint person_custom_fields_options_check check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 50
  )
);

create unique index person_custom_fields_org_name_unique
  on public.person_custom_fields (org_id, lower(btrim(name)));
create index person_custom_fields_org_status_name_idx
  on public.person_custom_fields (org_id, status, name);
create index person_custom_fields_created_by_idx
  on public.person_custom_fields (created_by) where created_by is not null;
create index person_custom_fields_updated_by_idx
  on public.person_custom_fields (updated_by) where updated_by is not null;

create table public.person_custom_field_values (
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  custom_field_id uuid not null,
  value jsonb not null,
  source_submission_id uuid references public.form_submissions(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, custom_field_id),
  constraint person_custom_field_values_field_org_fk
    foreign key (custom_field_id, org_id) references public.person_custom_fields(id, org_id) on delete restrict,
  constraint person_custom_field_values_size_check check (pg_column_size(value) <= 8192)
);

create index person_custom_field_values_org_member_idx
  on public.person_custom_field_values (org_id, member_id);
create index person_custom_field_values_field_idx
  on public.person_custom_field_values (custom_field_id);
create index person_custom_field_values_submission_idx
  on public.person_custom_field_values (source_submission_id) where source_submission_id is not null;
create index person_custom_field_values_updated_by_idx
  on public.person_custom_field_values (updated_by) where updated_by is not null;

create or replace function public.validate_person_custom_field_value_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.members m
    where m.id = new.member_id and m.org_id = new.org_id and m.status <> 'merged'
  ) or not exists (
    select 1 from public.person_custom_fields f
    where f.id = new.custom_field_id and f.org_id = new.org_id
  ) then
    raise exception 'PERSON_CUSTOM_VALUE_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

create trigger person_custom_field_values_validate_scope
before insert or update on public.person_custom_field_values
for each row execute function public.validate_person_custom_field_value_scope();

create table public.form_person_field_mappings (
  form_id uuid not null,
  org_id uuid not null,
  field_key uuid not null,
  target_type text not null,
  standard_key text,
  custom_field_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (form_id, field_key),
  constraint form_person_field_mappings_form_org_fk
    foreign key (form_id, org_id) references public.forms(id, org_id) on delete cascade,
  constraint form_person_field_mappings_custom_org_fk
    foreign key (custom_field_id, org_id) references public.person_custom_fields(id, org_id) on delete restrict,
  constraint form_person_field_mappings_target_check check (
    (target_type = 'standard' and standard_key is not null and custom_field_id is null)
    or (target_type = 'custom' and standard_key is null and custom_field_id is not null)
  ),
  constraint form_person_field_mappings_standard_key_check check (
    standard_key is null or standard_key in (
      'first_name', 'last_name', 'gender', 'age_group', 'email', 'phone',
      'address', 'marital_status', 'children_count', 'joined_at', 'dob',
      'notes', 'baptized', 'baptism_date', 'born_again', 'born_again_date',
      'department_category_id', 'first_visit_at', 'how_heard', 'prayer_requests'
    )
  )
);

create index form_person_field_mappings_org_form_idx
  on public.form_person_field_mappings (org_id, form_id);
create index form_person_field_mappings_custom_idx
  on public.form_person_field_mappings (custom_field_id) where custom_field_id is not null;
create index form_person_field_mappings_created_by_idx
  on public.form_person_field_mappings (created_by) where created_by is not null;

create table public.person_record_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  person_name text not null,
  event_type text not null,
  source_submission_id uuid references public.form_submissions(id) on delete set null,
  source_form_id uuid references public.forms(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_role text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint person_record_events_type_check check (event_type in (
    'created_member_from_form', 'created_visitor_from_form',
    'updated_member_from_form', 'updated_visitor_from_form'
  )),
  constraint person_record_events_role_check check (actor_role in ('owner', 'admin', 'finance', 'public')),
  constraint person_record_events_changes_check check (
    jsonb_typeof(changes) = 'object' and pg_column_size(changes) <= 65536
  )
);

create index person_record_events_org_created_idx
  on public.person_record_events (org_id, created_at desc);
create index person_record_events_member_created_idx
  on public.person_record_events (member_id, created_at desc) where member_id is not null;
create index person_record_events_submission_idx
  on public.person_record_events (source_submission_id) where source_submission_id is not null;
create index person_record_events_form_idx
  on public.person_record_events (source_form_id) where source_form_id is not null;
create index person_record_events_actor_idx
  on public.person_record_events (actor_id) where actor_id is not null;

alter table public.form_submissions
  add column person_action text,
  add column processed_at timestamptz,
  add column processed_by uuid references auth.users(id) on delete set null;

alter table public.form_submissions
  add constraint form_submissions_person_action_check check (
    person_action is null or person_action in (
      'created_member', 'created_visitor', 'updated_member', 'updated_visitor'
    )
  ),
  add constraint form_submissions_person_processing_check check (
    (person_action is null and processed_at is null)
    or (person_action is not null and processed_at is not null and result_member_id is not null)
  );

create index form_submissions_processed_by_idx
  on public.form_submissions (processed_by) where processed_by is not null;

alter table public.person_custom_fields enable row level security;
alter table public.person_custom_field_values enable row level security;
alter table public.form_person_field_mappings enable row level security;
alter table public.person_record_events enable row level security;

revoke all on table public.person_custom_fields from public, anon, authenticated;
revoke all on table public.person_custom_field_values from public, anon, authenticated;
revoke all on table public.form_person_field_mappings from public, anon, authenticated;
revoke all on table public.person_record_events from public, anon, authenticated;
grant select on table public.person_custom_fields to authenticated;
grant select on table public.person_custom_field_values to authenticated;
grant select on table public.form_person_field_mappings to authenticated;
grant select on table public.person_record_events to authenticated;
grant select, insert, update, delete on table public.person_custom_fields to service_role;
grant select, insert, update, delete on table public.person_custom_field_values to service_role;
grant select, insert, update, delete on table public.form_person_field_mappings to service_role;
grant select, insert on table public.person_record_events to service_role;

create policy person_custom_fields_select_managers
on public.person_custom_fields for select to authenticated
using ((select public.is_org_finance(org_id)));
create policy person_custom_field_values_select_managers
on public.person_custom_field_values for select to authenticated
using ((select public.is_org_finance(org_id)));
create policy form_person_field_mappings_select_managers
on public.form_person_field_mappings for select to authenticated
using ((select public.is_org_finance(org_id)));
create policy person_record_events_select_managers
on public.person_record_events for select to authenticated
using ((select public.is_org_finance(org_id)));

create or replace function private.validate_person_custom_value(
  p_field_type text,
  p_options jsonb,
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  if p_field_type = 'multiple_choice' then
    if pg_catalog.jsonb_typeof(p_value) <> 'array'
       or pg_catalog.jsonb_array_length(p_value) > 50
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(p_value) item
         where pg_catalog.jsonb_typeof(item) <> 'string'
            or not (p_options @> pg_catalog.jsonb_build_array(item))
       ) then raise exception 'PERSON_CUSTOM_VALUE_INVALID'; end if;
    if pg_catalog.jsonb_array_length(p_value) = 0 then return null; end if;
    return p_value;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then
    raise exception 'PERSON_CUSTOM_VALUE_INVALID';
  end if;
  v_text := pg_catalog.btrim(p_value #>> '{}');
  if v_text = '' then return null; end if;
  if pg_catalog.char_length(v_text) > (case when p_field_type = 'long_text' then 5000 else 1000 end)
     or (p_field_type = 'email' and v_text !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     or (p_field_type = 'number' and v_text !~ '^-?[0-9]+([.][0-9]+)?$')
     or (p_field_type = 'date' and v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     or (p_field_type in ('single_choice', 'dropdown') and not (p_options @> pg_catalog.jsonb_build_array(v_text)))
     or (p_field_type = 'yes_no' and pg_catalog.lower(v_text) not in ('yes', 'no')) then
    raise exception 'PERSON_CUSTOM_VALUE_INVALID';
  end if;
  return pg_catalog.to_jsonb(case when p_field_type = 'yes_no' then pg_catalog.lower(v_text) else v_text end);
end;
$$;

create or replace function public.ensure_first_timer_person_mapping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_integration text;
  v_mapping public.form_person_field_mappings%rowtype;
  v_custom public.person_custom_fields%rowtype;
begin
  select * into v_form from public.forms f where f.id = new.form_id;
  if v_form.form_kind <> 'first_timer' then return new; end if;

  select * into v_mapping from public.form_person_field_mappings m
  where m.form_id = new.form_id and m.field_key = new.field_key;
  if v_mapping.form_id is not null then
    if v_mapping.target_type = 'custom' then
      select * into v_custom from public.person_custom_fields c
      where c.id = v_mapping.custom_field_id for update;
      if v_custom.field_type <> new.field_type and exists (
        select 1 from public.person_custom_field_values cv
        where cv.custom_field_id = v_custom.id
      ) then raise exception 'CUSTOM_FIELD_TYPE_IN_USE'; end if;
      update public.person_custom_fields
      set name = new.label,
          field_type = new.field_type,
          options = new.options,
          status = 'active',
          updated_at = pg_catalog.clock_timestamp()
      where id = v_custom.id;
    end if;
    update public.form_person_field_mappings
    set updated_at = pg_catalog.clock_timestamp()
    where form_id = new.form_id and field_key = new.field_key;
    return new;
  end if;

  select i.integration_key into v_integration
  from private.form_field_integrations i
  where i.form_id = new.form_id and i.field_key = new.field_key;

  if v_integration is not null then
    insert into public.form_person_field_mappings (
      form_id, org_id, field_key, target_type, standard_key
    ) values (new.form_id, new.org_id, new.field_key, 'standard',
      case v_integration when 'prayer_requests' then 'prayer_requests' else v_integration end
    );
    return new;
  end if;

  select * into v_custom
  from public.person_custom_fields c
  where c.org_id = new.org_id
    and pg_catalog.lower(pg_catalog.btrim(c.name)) = pg_catalog.lower(pg_catalog.btrim(new.label))
  for update;

  if v_custom.id is null then
    begin
      insert into public.person_custom_fields (
        org_id, name, field_type, options
      ) values (
        new.org_id, new.label, new.field_type, new.options
      ) returning * into v_custom;
    exception when unique_violation then
      select * into v_custom
      from public.person_custom_fields c
      where c.org_id = new.org_id
        and pg_catalog.lower(pg_catalog.btrim(c.name)) = pg_catalog.lower(pg_catalog.btrim(new.label))
      for update;
    end;
  else
    update public.person_custom_fields
    set status = 'active', updated_at = pg_catalog.clock_timestamp()
    where id = v_custom.id
    returning * into v_custom;
  end if;

  if v_custom.field_type <> new.field_type and exists (
    select 1 from public.person_custom_field_values cv where cv.custom_field_id = v_custom.id
  ) then raise exception 'CUSTOM_FIELD_TYPE_IN_USE'; end if;
  update public.person_custom_fields
  set field_type = new.field_type, options = new.options
  where id = v_custom.id;

  insert into public.form_person_field_mappings (
    form_id, org_id, field_key, target_type, custom_field_id
  ) values (new.form_id, new.org_id, new.field_key, 'custom', v_custom.id);
  return new;
end;
$$;

create trigger zz_form_fields_ensure_first_timer_person_mapping
after insert on public.form_fields
for each row execute function public.ensure_first_timer_person_mapping();

insert into public.form_person_field_mappings (
  form_id, org_id, field_key, target_type, standard_key
)
select ff.form_id, ff.org_id, ff.field_key, 'standard', i.integration_key
from public.form_fields ff
join public.forms f on f.id = ff.form_id and f.form_kind = 'first_timer'
join private.form_field_integrations i on i.form_id = ff.form_id and i.field_key = ff.field_key
on conflict (form_id, field_key) do nothing;

-- All currently shipped First Timer fields are represented by the integration
-- registry above. Future custom fields are registered by the insert trigger.

create or replace function public.prepare_first_timer_submission_person_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_kind text;
begin
  if new.result_member_id is null or new.person_action is not null then return new; end if;
  select f.form_kind into v_kind from public.forms f where f.id = new.form_id;
  if v_kind = 'first_timer' then
    new.person_action := case when new.source_type = 'personal' then 'updated_visitor' else 'created_visitor' end;
    new.processed_at := coalesce(new.submitted_at, pg_catalog.clock_timestamp());
  end if;
  return new;
end;
$$;

create trigger form_submissions_prepare_first_timer_person_link
before insert on public.form_submissions
for each row execute function public.prepare_first_timer_submission_person_link();

create or replace function private.apply_first_timer_submission_to_person(
  p_submission_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.form_submissions%rowtype;
  v_mapping record;
  v_definition public.person_custom_fields%rowtype;
  v_value jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_name text;
begin
  select * into v_submission from public.form_submissions s
  where s.id = p_submission_id;
  if v_submission.id is null or v_submission.result_member_id is null then return; end if;
  if not exists (
    select 1 from public.forms f where f.id = v_submission.form_id and f.form_kind = 'first_timer'
  ) then return; end if;

  for v_mapping in
    select m.*, field_snapshot.value->>'label' as submitted_label
    from public.form_person_field_mappings m
    left join lateral (
      select value from pg_catalog.jsonb_array_elements(v_submission.form_snapshot->'fields') item(value)
      where value->>'key' = m.field_key::text
    ) field_snapshot on true
    where m.form_id = v_submission.form_id and m.target_type = 'custom'
  loop
    if not (v_submission.answers ? v_mapping.field_key::text) then continue; end if;
    select * into v_definition from public.person_custom_fields c
    where c.id = v_mapping.custom_field_id;
    v_value := private.validate_person_custom_value(
      v_definition.field_type, v_definition.options,
      v_submission.answers->v_mapping.field_key::text
    );
    if v_value is null then continue; end if;
    insert into public.person_custom_field_values (
      org_id, member_id, custom_field_id, value, source_submission_id
    ) values (
      v_submission.org_id, v_submission.result_member_id,
      v_definition.id, v_value, v_submission.id
    ) on conflict (member_id, custom_field_id) do update
    set value = excluded.value,
        source_submission_id = excluded.source_submission_id,
        updated_at = pg_catalog.clock_timestamp();
    v_changes := v_changes || pg_catalog.jsonb_build_object(
      v_definition.id::text,
      pg_catalog.jsonb_build_object('label', coalesce(v_mapping.submitted_label, v_definition.name), 'new', v_value)
    );
  end loop;

  select concat_ws(' ', m.first_name, m.last_name) into v_name
  from public.members m where m.id = v_submission.result_member_id;
  if not exists (
    select 1 from public.person_record_events e where e.source_submission_id = v_submission.id
  ) then
    insert into public.person_record_events (
      org_id, member_id, person_name, event_type, source_submission_id,
      source_form_id, actor_role, changes, created_at
    ) values (
      v_submission.org_id, v_submission.result_member_id, coalesce(nullif(v_name, ''), 'Visitor'),
      case when v_submission.person_action = 'updated_visitor'
        then 'updated_visitor_from_form' else 'created_visitor_from_form' end,
      v_submission.id, v_submission.form_id, 'public',
      pg_catalog.jsonb_build_object('custom', v_changes),
      coalesce(v_submission.processed_at, v_submission.submitted_at)
    );
  end if;
end;
$$;

create or replace function public.apply_first_timer_submission_to_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_first_timer_submission_to_person(new.id);
  return new;
end;
$$;

create trigger form_submissions_apply_first_timer_to_person
after insert on public.form_submissions
for each row execute function public.apply_first_timer_submission_to_person();

create or replace function public.process_form_submission_to_person(
  p_submission_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_member_id uuid,
  p_standard_values jsonb,
  p_standard_mappings jsonb,
  p_custom_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.form_submissions%rowtype;
  v_form public.forms%rowtype;
  v_member public.members%rowtype;
  v_role text;
  v_actor_email text;
  v_member_id uuid;
  v_stage text;
  v_event_type text;
  v_person_action text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_standard_changes jsonb := '{}'::jsonb;
  v_custom_changes jsonb := '{}'::jsonb;
  v_key text;
  v_custom jsonb;
  v_definition public.person_custom_fields%rowtype;
  v_old_value jsonb;
  v_new_value jsonb;
  v_source_key text;
  v_name text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_action not in ('create_member', 'create_visitor', 'update_person')
     or p_standard_values is null or pg_catalog.jsonb_typeof(p_standard_values) <> 'object'
     or p_standard_mappings is null or pg_catalog.jsonb_typeof(p_standard_mappings) <> 'object'
     or p_custom_values is null or pg_catalog.jsonb_typeof(p_custom_values) <> 'array'
     or pg_catalog.jsonb_array_length(p_custom_values) > 50 then
    raise exception 'PERSON_PROCESSING_INVALID';
  end if;

  select * into v_submission from public.form_submissions s
  where s.id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  select * into v_form from public.forms f where f.id = v_submission.form_id;
  if v_form.form_kind = 'first_timer' then raise exception 'FIRST_TIMER_ALREADY_AUTOMATIC'; end if;
  if v_submission.person_action is not null or v_submission.result_member_id is not null then
    raise exception 'SUBMISSION_ALREADY_PROCESSED';
  end if;

  select uo.role into v_role from public.user_organizations uo
  where uo.organization_id = v_submission.org_id and uo.user_id = p_actor_id;
  if v_role not in ('owner', 'admin', 'finance') then raise exception 'Forbidden'; end if;
  select u.email into v_actor_email from auth.users u where u.id = p_actor_id;

  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_standard_values) supplied(key)
    where supplied.key not in (
      'first_name','last_name','gender','age_group','email','phone','address',
      'marital_status','children_count','joined_at','dob','notes','baptized',
      'baptism_date','born_again','born_again_date','department_category_id',
      'first_visit_at','how_heard','prayer_requests'
    )
  ) then raise exception 'PERSON_PROCESSING_INVALID'; end if;

  if p_action in ('create_member', 'create_visitor') then
    if nullif(pg_catalog.btrim(p_standard_values->>'first_name'), '') is null
       or nullif(pg_catalog.btrim(p_standard_values->>'last_name'), '') is null
       or pg_catalog.lower(p_standard_values->>'gender') not in ('male','female')
       or p_standard_values->>'age_group' not in ('1-12','13-17','18-35','36+') then
      raise exception 'PERSON_REQUIRED_FIELDS';
    end if;
    v_stage := case when p_action = 'create_member' then 'member' else 'visitor' end;
    insert into public.members (
      org_id, first_name, last_name, gender, age_group, segment,
      email, phone, address, marital_status, children_count, joined_at, dob,
      notes, baptized, baptism_date, born_again, born_again_date,
      department_category_id, membership_stage, profile_complete,
      status, created_by, updated_by, created_at, updated_at
    ) values (
      v_submission.org_id,
      pg_catalog.btrim(p_standard_values->>'first_name'),
      pg_catalog.btrim(p_standard_values->>'last_name'),
      pg_catalog.lower(p_standard_values->>'gender'),
      p_standard_values->>'age_group',
      public.compute_segment(pg_catalog.lower(p_standard_values->>'gender'), p_standard_values->>'age_group'),
      nullif(pg_catalog.lower(pg_catalog.btrim(p_standard_values->>'email')), ''),
      nullif(pg_catalog.btrim(p_standard_values->>'phone'), ''),
      nullif(pg_catalog.btrim(p_standard_values->>'address'), ''),
      nullif(pg_catalog.btrim(p_standard_values->>'marital_status'), ''),
      nullif(p_standard_values->>'children_count','')::integer,
      nullif(p_standard_values->>'joined_at','')::date,
      nullif(p_standard_values->>'dob','')::date,
      nullif(pg_catalog.btrim(p_standard_values->>'notes'), ''),
      nullif(p_standard_values->>'baptized','')::boolean,
      nullif(p_standard_values->>'baptism_date','')::date,
      nullif(p_standard_values->>'born_again','')::boolean,
      nullif(p_standard_values->>'born_again_date','')::date,
      nullif(p_standard_values->>'department_category_id','')::uuid,
      v_stage,
      nullif(pg_catalog.btrim(p_standard_values->>'phone'), '') is not null,
      'active', p_actor_id, p_actor_id, v_now, v_now
    ) returning * into v_member;
    v_member_id := v_member.id;
    if v_stage = 'visitor' then
      insert into public.visitor_details (
        member_id, first_visit_at, follow_up_status, how_heard,
        prayer_request_tags, next_follow_up_at, updated_at
      ) values (
        v_member_id,
        coalesce(nullif(p_standard_values->>'first_visit_at','')::date, v_now::date),
        'new', nullif(pg_catalog.btrim(p_standard_values->>'how_heard'), ''),
        case when pg_catalog.jsonb_typeof(p_standard_values->'prayer_requests') = 'array'
          then array(select pg_catalog.jsonb_array_elements_text(p_standard_values->'prayer_requests')) else null end,
        coalesce(nullif(p_standard_values->>'first_visit_at','')::date, v_now::date) + 3,
        v_now
      );
    end if;
    v_event_type := case when v_stage='member' then 'created_member_from_form' else 'created_visitor_from_form' end;
    v_person_action := case when v_stage='member' then 'created_member' else 'created_visitor' end;
  else
    select * into v_member from public.members m
    where m.id = p_target_member_id and m.org_id = v_submission.org_id
    for update;
    if v_member.id is null or v_member.status = 'merged' then raise exception 'PERSON_TARGET_INVALID'; end if;
    if v_role = 'finance' and exists (
      select 1 from pg_catalog.jsonb_object_keys(p_standard_values) protected(key)
      where protected.key in ('first_name','last_name','gender','age_group')
    ) then raise exception 'FINANCE_IDENTITY_FIELDS_LOCKED'; end if;
    v_member_id := v_member.id;
    v_before := pg_catalog.to_jsonb(v_member);
    update public.members m set
      first_name = case when p_standard_values ? 'first_name' then pg_catalog.btrim(p_standard_values->>'first_name') else m.first_name end,
      last_name = case when p_standard_values ? 'last_name' then pg_catalog.btrim(p_standard_values->>'last_name') else m.last_name end,
      gender = case when p_standard_values ? 'gender' then pg_catalog.lower(p_standard_values->>'gender') else m.gender end,
      age_group = case when p_standard_values ? 'age_group' then p_standard_values->>'age_group' else m.age_group end,
      email = case when p_standard_values ? 'email' then nullif(pg_catalog.lower(pg_catalog.btrim(p_standard_values->>'email')), '') else m.email end,
      phone = case when p_standard_values ? 'phone' then nullif(pg_catalog.btrim(p_standard_values->>'phone'), '') else m.phone end,
      address = case when p_standard_values ? 'address' then nullif(pg_catalog.btrim(p_standard_values->>'address'), '') else m.address end,
      marital_status = case when p_standard_values ? 'marital_status' then nullif(pg_catalog.btrim(p_standard_values->>'marital_status'), '') else m.marital_status end,
      children_count = case when p_standard_values ? 'children_count' then nullif(p_standard_values->>'children_count','')::integer else m.children_count end,
      joined_at = case when p_standard_values ? 'joined_at' then nullif(p_standard_values->>'joined_at','')::date else m.joined_at end,
      dob = case when p_standard_values ? 'dob' then nullif(p_standard_values->>'dob','')::date else m.dob end,
      notes = case when p_standard_values ? 'notes' then nullif(pg_catalog.btrim(p_standard_values->>'notes'), '') else m.notes end,
      baptized = case when p_standard_values ? 'baptized' then nullif(p_standard_values->>'baptized','')::boolean else m.baptized end,
      baptism_date = case when p_standard_values ? 'baptism_date' then nullif(p_standard_values->>'baptism_date','')::date else m.baptism_date end,
      born_again = case when p_standard_values ? 'born_again' then nullif(p_standard_values->>'born_again','')::boolean else m.born_again end,
      born_again_date = case when p_standard_values ? 'born_again_date' then nullif(p_standard_values->>'born_again_date','')::date else m.born_again_date end,
      department_category_id = case when p_standard_values ? 'department_category_id' then nullif(p_standard_values->>'department_category_id','')::uuid else m.department_category_id end,
      segment = public.compute_segment(
        case when p_standard_values ? 'gender' then pg_catalog.lower(p_standard_values->>'gender') else m.gender end,
        case when p_standard_values ? 'age_group' then p_standard_values->>'age_group' else m.age_group end
      ),
      updated_by = p_actor_id, updated_at = v_now
    where m.id = v_member_id returning * into v_member;
    if p_standard_values ? 'first_visit_at' or p_standard_values ? 'how_heard' or p_standard_values ? 'prayer_requests' then
      insert into public.visitor_details (member_id, first_visit_at, how_heard, prayer_request_tags, updated_at)
      values (
        v_member_id, nullif(p_standard_values->>'first_visit_at','')::date,
        nullif(pg_catalog.btrim(p_standard_values->>'how_heard'), ''),
        case when pg_catalog.jsonb_typeof(p_standard_values->'prayer_requests')='array'
          then array(select pg_catalog.jsonb_array_elements_text(p_standard_values->'prayer_requests')) else null end,
        v_now
      ) on conflict (member_id) do update set
        first_visit_at = case when p_standard_values ? 'first_visit_at' then excluded.first_visit_at else public.visitor_details.first_visit_at end,
        how_heard = case when p_standard_values ? 'how_heard' then excluded.how_heard else public.visitor_details.how_heard end,
        prayer_request_tags = case when p_standard_values ? 'prayer_requests' then excluded.prayer_request_tags else public.visitor_details.prayer_request_tags end,
        updated_at = v_now;
    end if;
    v_after := pg_catalog.to_jsonb(v_member);
    v_event_type := case when v_member.membership_stage='visitor' then 'updated_visitor_from_form' else 'updated_member_from_form' end;
    v_person_action := case when v_member.membership_stage='visitor' then 'updated_visitor' else 'updated_member' end;
  end if;

  if p_action in ('create_member','create_visitor') then
    v_after := pg_catalog.to_jsonb(v_member);
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_standard_values)
  loop
    v_standard_changes := v_standard_changes || pg_catalog.jsonb_build_object(
      v_key, pg_catalog.jsonb_build_object('old', v_before->v_key, 'new', v_after->v_key)
    );
  end loop;

  for v_key in select key from pg_catalog.jsonb_each_text(p_standard_mappings)
  loop
    v_source_key := p_standard_mappings->>v_key;
    if v_source_key !~ '^[0-9a-f-]{36}$' or not (v_submission.answers ? v_source_key) then
      raise exception 'PERSON_MAPPING_INVALID';
    end if;
    insert into public.form_person_field_mappings (
      form_id, org_id, field_key, target_type, standard_key, created_by
    ) values (
      v_submission.form_id, v_submission.org_id, v_source_key::uuid,
      'standard', v_key, p_actor_id
    ) on conflict (form_id, field_key) do update
    set target_type='standard', standard_key=excluded.standard_key,
        custom_field_id=null, updated_at=v_now;
  end loop;

  for v_custom in select value from pg_catalog.jsonb_array_elements(p_custom_values)
  loop
    if pg_catalog.jsonb_typeof(v_custom) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_custom) k
         where k not in ('field_id','name','field_type','options','value','source_field_key')) then
      raise exception 'PERSON_CUSTOM_VALUE_INVALID';
    end if;
    if nullif(v_custom->>'field_id','') is not null then
      select * into v_definition from public.person_custom_fields c
      where c.id=(v_custom->>'field_id')::uuid and c.org_id=v_submission.org_id for update;
      if v_definition.id is null then raise exception 'PERSON_CUSTOM_FIELD_INVALID'; end if;
    else
      if nullif(pg_catalog.btrim(v_custom->>'name'),'') is null then raise exception 'PERSON_CUSTOM_FIELD_INVALID'; end if;
      select * into v_definition from public.person_custom_fields c
      where c.org_id=v_submission.org_id and pg_catalog.lower(pg_catalog.btrim(c.name))=pg_catalog.lower(pg_catalog.btrim(v_custom->>'name'))
      for update;
      if v_definition.id is null then
        insert into public.person_custom_fields (org_id,name,field_type,options,created_by,updated_by)
        values (v_submission.org_id,pg_catalog.btrim(v_custom->>'name'),v_custom->>'field_type',coalesce(v_custom->'options','[]'::jsonb),p_actor_id,p_actor_id)
        returning * into v_definition;
      end if;
    end if;
    v_new_value := private.validate_person_custom_value(v_definition.field_type,v_definition.options,v_custom->'value');
    select cv.value into v_old_value from public.person_custom_field_values cv
    where cv.member_id=v_member_id and cv.custom_field_id=v_definition.id;
    if v_new_value is null then
      delete from public.person_custom_field_values where member_id=v_member_id and custom_field_id=v_definition.id;
    else
      insert into public.person_custom_field_values(org_id,member_id,custom_field_id,value,source_submission_id,updated_by)
      values(v_submission.org_id,v_member_id,v_definition.id,v_new_value,v_submission.id,p_actor_id)
      on conflict(member_id,custom_field_id) do update set value=excluded.value,source_submission_id=excluded.source_submission_id,updated_by=excluded.updated_by,updated_at=v_now;
    end if;
    v_custom_changes := v_custom_changes || pg_catalog.jsonb_build_object(
      v_definition.id::text,pg_catalog.jsonb_build_object('label',v_definition.name,'old',v_old_value,'new',v_new_value)
    );
    v_source_key := nullif(v_custom->>'source_field_key','');
    if v_source_key is not null then
      if v_source_key !~ '^[0-9a-f-]{36}$' or not (v_submission.answers ? v_source_key) then raise exception 'PERSON_MAPPING_INVALID'; end if;
      insert into public.form_person_field_mappings(form_id,org_id,field_key,target_type,custom_field_id,created_by)
      values(v_submission.form_id,v_submission.org_id,v_source_key::uuid,'custom',v_definition.id,p_actor_id)
      on conflict(form_id,field_key) do update set target_type='custom',standard_key=null,custom_field_id=excluded.custom_field_id,updated_at=v_now;
    end if;
  end loop;

  update public.form_submissions
  set result_member_id=v_member_id, person_action=v_person_action,
      processed_at=v_now, processed_by=p_actor_id,
      status='reviewed', reviewed_at=coalesce(reviewed_at,v_now), reviewed_by=coalesce(reviewed_by,p_actor_id)
  where id=v_submission.id;

  select concat_ws(' ',m.first_name,m.last_name) into v_name from public.members m where m.id=v_member_id;
  insert into public.person_record_events(
    org_id,member_id,person_name,event_type,source_submission_id,source_form_id,
    actor_id,actor_email,actor_role,changes,created_at
  ) values (
    v_submission.org_id,v_member_id,coalesce(nullif(v_name,''),'Person'),v_event_type,
    v_submission.id,v_submission.form_id,p_actor_id,v_actor_email,v_role,
    pg_catalog.jsonb_build_object('standard',v_standard_changes,'custom',v_custom_changes),v_now
  );

  return pg_catalog.jsonb_build_object('member_id',v_member_id,'person_action',v_person_action);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'PERSON_PROCESSING_INVALID';
end;
$$;

create or replace function public.prevent_finance_identity_field_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and exists (
    select 1 from public.user_organizations uo
    where uo.organization_id=old.org_id and uo.user_id=(select auth.uid()) and uo.role='finance'
  ) and (
    new.first_name is distinct from old.first_name
    or new.last_name is distinct from old.last_name
    or new.gender is distinct from old.gender
    or new.age_group is distinct from old.age_group
  ) then raise exception 'FINANCE_IDENTITY_FIELDS_LOCKED'; end if;
  return new;
end;
$$;

create or replace function public.update_person_custom_fields(
  p_member_id uuid,
  p_actor_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_item jsonb;
  v_definition public.person_custom_fields%rowtype;
  v_value jsonb;
begin
  if p_values is null or pg_catalog.jsonb_typeof(p_values) <> 'array'
     or pg_catalog.jsonb_array_length(p_values) > 50 then
    raise exception 'PERSON_CUSTOM_VALUE_INVALID';
  end if;
  select * into v_member from public.members m where m.id=p_member_id for update;
  if v_member.id is null or v_member.status='merged' then raise exception 'PERSON_TARGET_INVALID'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id=v_member.org_id and uo.user_id=p_actor_id
      and uo.role in ('owner','admin','finance')
  ) then raise exception 'Forbidden'; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_values)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k where k not in ('field_id','value')) then
      raise exception 'PERSON_CUSTOM_VALUE_INVALID';
    end if;
    select * into v_definition from public.person_custom_fields f
    where f.id=nullif(v_item->>'field_id','')::uuid and f.org_id=v_member.org_id and f.status='active'
    for update;
    if v_definition.id is null then raise exception 'PERSON_CUSTOM_FIELD_INVALID'; end if;
    v_value := private.validate_person_custom_value(v_definition.field_type,v_definition.options,v_item->'value');
    if v_value is null then
      delete from public.person_custom_field_values
      where member_id=v_member.id and custom_field_id=v_definition.id;
    else
      insert into public.person_custom_field_values(org_id,member_id,custom_field_id,value,updated_by)
      values(v_member.org_id,v_member.id,v_definition.id,v_value,p_actor_id)
      on conflict(member_id,custom_field_id) do update
      set value=excluded.value,updated_by=excluded.updated_by,updated_at=pg_catalog.clock_timestamp();
    end if;
  end loop;
end;
$$;

create trigger members_protect_identity_fields_from_finance
before update of first_name,last_name,gender,age_group on public.members
for each row execute function public.prevent_finance_identity_field_update();

do $$
declare v_submission record;
begin
  for v_submission in
    select s.id from public.form_submissions s
    join public.forms f on f.id=s.form_id
    where f.form_kind='first_timer' and s.result_member_id is not null
  loop
    update public.form_submissions s set
      person_action=coalesce(s.person_action,case when s.source_type='personal' then 'updated_visitor' else 'created_visitor' end),
      processed_at=coalesce(s.processed_at,s.submitted_at)
    where s.id=v_submission.id;
    perform private.apply_first_timer_submission_to_person(v_submission.id);
  end loop;
end $$;

revoke all on function private.validate_person_custom_value(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.validate_person_custom_field_value_scope() from public,anon,authenticated,service_role;
revoke all on function public.ensure_first_timer_person_mapping() from public,anon,authenticated,service_role;
revoke all on function public.prepare_first_timer_submission_person_link() from public,anon,authenticated,service_role;
revoke all on function private.apply_first_timer_submission_to_person(uuid) from public,anon,authenticated,service_role;
revoke all on function public.apply_first_timer_submission_to_person() from public,anon,authenticated,service_role;
revoke all on function public.prevent_finance_identity_field_update() from public,anon,authenticated,service_role;
revoke all on function public.update_person_custom_fields(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_person_custom_fields(uuid,uuid,jsonb) to service_role;
revoke all on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb) to service_role;
