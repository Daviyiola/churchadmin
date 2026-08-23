alter table public.form_submissions
  add column source_type text not null default 'permanent',
  add column source_campaign_id uuid references public.intake_campaigns(id) on delete set null,
  add column source_label text;

alter table public.form_submissions
  add constraint form_submissions_source_type_check
    check (source_type in ('permanent', 'campaign', 'personal')),
  add constraint form_submissions_source_campaign_check
    check (
      (source_type = 'campaign' and source_campaign_id is not null)
      or (source_type <> 'campaign' and source_campaign_id is null)
    );

create index form_submissions_source_campaign_idx
  on public.form_submissions (source_campaign_id)
  where source_campaign_id is not null;

comment on column public.form_submissions.source_type is
  'Immutable intake path attribution. Permanent is the built-in share link, campaign is a campaign QR/link, and personal is a single-use invitation.';
comment on column public.form_submissions.source_label is
  'Safe source-name snapshot, such as the campaign name. Raw personal intake tokens are never stored here.';

create or replace function private.validate_form_submission_answers(
  p_form_id uuid,
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
begin
  if p_answers is null
     or pg_catalog.jsonb_typeof(p_answers) <> 'object'
     or pg_catalog.pg_column_size(p_answers) > 65536 then
    raise exception 'FORM_INVALID_SUBMISSION';
  end if;

  select * into v_form from public.forms f where f.id = p_form_id;
  if v_form.id is null then raise exception 'FORM_NOT_FOUND'; end if;
  if v_form.status <> 'open' then raise exception 'FORM_NOT_ACTIVE'; end if;

  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_answers) supplied(key)
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
      if pg_catalog.jsonb_typeof(v_answer) <> 'array'
         or pg_catalog.jsonb_array_length(v_answer) > 50
         or (v_field.is_required and pg_catalog.jsonb_array_length(v_answer) = 0)
         or exists (
           select 1 from pg_catalog.jsonb_array_elements(v_answer) selected(value)
           where pg_catalog.jsonb_typeof(selected.value) <> 'string'
              or not (v_field.options @> pg_catalog.jsonb_build_array(selected.value))
         ) then raise exception 'FORM_INVALID_FIELD'; end if;
    else
      if pg_catalog.jsonb_typeof(v_answer) <> 'string' then raise exception 'FORM_INVALID_FIELD'; end if;
      v_text := pg_catalog.btrim(v_answer #>> '{}');
      if v_field.is_required and v_text = '' then raise exception 'FORM_REQUIRED_FIELD'; end if;
      if pg_catalog.char_length(v_text) > (case when v_field.field_type = 'long_text' then 5000 else 1000 end) then
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

  return v_snapshot;
end;
$$;

create or replace function public.submit_campaign_first_timer_form(
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
  v_campaign public.intake_campaigns%rowtype;
  v_form public.forms%rowtype;
  v_result jsonb;
  v_submission public.form_submissions%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_request_id is null then raise exception 'FORM_INVALID_SUBMISSION'; end if;

  select * into v_campaign
  from public.intake_campaigns c
  where c.slug = p_slug
  for update;

  if v_campaign.id is null then raise exception 'INTAKE_INVALID'; end if;
  if not v_campaign.is_active then raise exception 'INTAKE_INACTIVE'; end if;
  if v_campaign.expires_at is not null and v_campaign.expires_at <= v_now then
    raise exception 'INTAKE_EXPIRED';
  end if;

  select * into v_form
  from public.forms f
  where f.org_id = v_campaign.org_id
    and f.form_kind = 'first_timer'
    and f.is_system
  for update;

  if v_form.id is null then raise exception 'FORM_NOT_FOUND'; end if;
  if v_form.status <> 'open' then raise exception 'FORM_NOT_ACTIVE'; end if;

  v_result := public.submit_public_form(v_form.slug, p_request_id, p_answers);

  select * into v_submission
  from public.form_submissions s
  where s.id = (v_result->>'submission_id')::uuid
  for update;

  if v_submission.source_type = 'campaign'
     and v_submission.source_campaign_id = v_campaign.id then
    return v_result || pg_catalog.jsonb_build_object('source_type', 'campaign');
  end if;
  if v_submission.source_type <> 'permanent' then
    raise exception 'FORM_REQUEST_CONFLICT';
  end if;

  update public.form_submissions
  set source_type = 'campaign',
      source_campaign_id = v_campaign.id,
      source_label = v_campaign.name
  where id = v_submission.id;

  return v_result || pg_catalog.jsonb_build_object('source_type', 'campaign');
end;
$$;

create or replace function public.get_personal_first_timer_form_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.intake_tokens%rowtype;
  v_member public.members%rowtype;
  v_form public.forms%rowtype;
  v_visitor public.visitor_details%rowtype;
  v_initial jsonb := '{}'::jsonb;
  v_readonly jsonb := '[]'::jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_token from public.intake_tokens t where t.token = p_token;
  if v_token.token is null then raise exception 'INTAKE_INVALID'; end if;
  if v_token.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if v_token.expires_at <= v_now then raise exception 'INTAKE_EXPIRED'; end if;

  select * into v_member from public.members m
  where m.id = v_token.member_id and m.org_id = v_token.org_id;
  if v_member.id is null or v_member.status = 'merged' then raise exception 'INTAKE_INVALID'; end if;

  select * into v_form from public.forms f
  where f.org_id = v_token.org_id and f.form_kind = 'first_timer' and f.is_system;
  if v_form.id is null then raise exception 'FORM_NOT_FOUND'; end if;
  if v_form.status <> 'open' then raise exception 'FORM_NOT_ACTIVE'; end if;

  select * into v_visitor from public.visitor_details vd where vd.member_id = v_member.id;

  select
    coalesce(pg_catalog.jsonb_object_agg(i.field_key::text,
      case i.integration_key
        when 'first_name' then pg_catalog.to_jsonb(coalesce(v_member.first_name, ''))
        when 'last_name' then pg_catalog.to_jsonb(coalesce(v_member.last_name, ''))
        when 'gender' then pg_catalog.to_jsonb(coalesce(v_member.gender, ''))
        when 'age_group' then pg_catalog.to_jsonb(coalesce(v_member.age_group, ''))
        when 'email' then pg_catalog.to_jsonb(coalesce(v_token.invited_email, ''))
        when 'phone' then pg_catalog.to_jsonb(coalesce(v_member.phone, ''))
        when 'address' then pg_catalog.to_jsonb(coalesce(v_member.address, ''))
        when 'marital_status' then pg_catalog.to_jsonb(coalesce(v_member.marital_status, ''))
        when 'children_count' then pg_catalog.to_jsonb(coalesce(v_member.children_count::text, ''))
        when 'how_heard' then pg_catalog.to_jsonb(coalesce(v_visitor.how_heard, ''))
        when 'prayer_requests' then pg_catalog.to_jsonb(coalesce(pg_catalog.array_to_string(v_visitor.prayer_request_tags, E'\n'), ''))
      end
    ), '{}'::jsonb),
    coalesce(pg_catalog.jsonb_agg(i.field_key::text) filter (where i.integration_key = 'email'), '[]'::jsonb)
  into v_initial, v_readonly
  from private.form_field_integrations i
  join public.form_fields ff on ff.form_id = i.form_id and ff.field_key = i.field_key
  where i.form_id = v_form.id;

  return pg_catalog.jsonb_build_object(
    'org_id', v_token.org_id,
    'member_id', v_member.id,
    'form_id', v_form.id,
    'initial_answers', v_initial,
    'readonly_field_keys', v_readonly
  );
end;
$$;

create or replace function public.submit_personal_first_timer_form(
  p_token text,
  p_request_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.intake_tokens%rowtype;
  v_form public.forms%rowtype;
  v_snapshot jsonb;
  v_existing public.form_submissions%rowtype;
  v_result jsonb;
  v_submission_id uuid := pg_catalog.gen_random_uuid();
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
begin
  if p_request_id is null then raise exception 'FORM_INVALID_SUBMISSION'; end if;

  select * into v_token
  from public.intake_tokens t where t.token = p_token for update;
  if v_token.token is null then raise exception 'INTAKE_INVALID'; end if;

  select * into v_form from public.forms f
  where f.org_id = v_token.org_id and f.form_kind = 'first_timer' and f.is_system
  for update;
  if v_form.id is null then raise exception 'FORM_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_form.id::text || ':' || p_request_id::text)
  );

  select * into v_existing from public.form_submissions s
  where s.form_id = v_form.id and s.request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.source_type <> 'personal'
       or v_existing.result_member_id is distinct from v_token.member_id then
      raise exception 'FORM_REQUEST_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'submission_id', v_existing.id,
      'member_id', v_existing.result_member_id,
      'idempotent', true,
      'source_type', 'personal'
    );
  end if;

  if v_token.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if v_token.expires_at <= v_now then raise exception 'INTAKE_EXPIRED'; end if;

  v_snapshot := private.validate_form_submission_answers(v_form.id, p_answers);

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

  v_children_text := nullif(pg_catalog.btrim(coalesce(v_children_text, '')), '');
  if v_children_text is not null and v_children_text !~ '^[0-9]+$' then
    raise exception 'INTAKE_INVALID_FIELDS';
  end if;
  v_children_count := case when v_children_text is null then null else v_children_text::integer end;
  if v_children_count is not null and v_children_count > 100 then
    raise exception 'INTAKE_INVALID_FIELDS';
  end if;

  v_result := public.complete_personal_intake(
    p_token,
    pg_catalog.btrim(coalesce(v_first_name, '')),
    pg_catalog.btrim(coalesce(v_last_name, '')),
    pg_catalog.lower(pg_catalog.btrim(coalesce(v_email, v_token.invited_email, ''))),
    pg_catalog.btrim(coalesce(v_phone, '')),
    nullif(pg_catalog.btrim(coalesce(v_address, '')), ''),
    nullif(pg_catalog.btrim(coalesce(v_marital_status, '')), ''),
    v_children_count,
    pg_catalog.lower(pg_catalog.btrim(coalesce(v_gender, ''))),
    pg_catalog.btrim(coalesce(v_age_group, '')),
    nullif(pg_catalog.btrim(coalesce(v_how_heard, '')), ''),
    case when nullif(pg_catalog.btrim(coalesce(v_prayer_requests, '')), '') is null
      then null else array[pg_catalog.btrim(v_prayer_requests)] end
  );

  insert into public.form_submissions (
    id, form_id, org_id, form_revision, request_id, status,
    form_snapshot, answers, result_member_id, submitted_at, reviewed_at,
    source_type, source_label
  ) values (
    v_submission_id, v_form.id, v_form.org_id, v_form.revision, p_request_id,
    'reviewed', v_snapshot, p_answers, v_token.member_id, v_now, v_now,
    'personal', 'Personal invitation'
  );

  insert into public.form_submission_events (
    submission_id, form_id, org_id, action
  ) values (v_submission_id, v_form.id, v_form.org_id, 'submitted');

  return v_result || pg_catalog.jsonb_build_object(
    'submission_id', v_submission_id,
    'idempotent', false,
    'source_type', 'personal'
  );
end;
$$;

revoke all on function private.validate_form_submission_answers(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_campaign_first_timer_form(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_personal_first_timer_form_context(text)
  from public, anon, authenticated;
revoke all on function public.submit_personal_first_timer_form(text, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.submit_campaign_first_timer_form(text, uuid, jsonb)
  to service_role;
grant execute on function public.get_personal_first_timer_form_context(text)
  to service_role;
grant execute on function public.submit_personal_first_timer_form(text, uuid, jsonb)
  to service_role;
