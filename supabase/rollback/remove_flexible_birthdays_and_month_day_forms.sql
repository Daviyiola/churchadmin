-- This rollback is intentionally blocked once month/day-only data exists.
do $$
begin
  if exists (select 1 from public.members where dob is null and birth_month is not null)
     or exists (select 1 from public.form_fields where field_type = 'month_day')
     or exists (select 1 from public.person_custom_fields where field_type = 'month_day') then
    raise exception 'Month/day-only data exists. Disable the UI instead of dropping the data.';
  end if;
end $$;

drop function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb);
alter function public.process_form_submission_to_person_base(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  rename to process_form_submission_to_person;
revoke all on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  to service_role;

drop trigger form_submissions_validate_month_day on public.form_submissions;
drop function private.validate_month_day_form_answers();

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
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then raise exception 'PERSON_CUSTOM_VALUE_INVALID'; end if;
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

alter table public.person_custom_fields drop constraint person_custom_fields_type_check;
alter table public.person_custom_fields add constraint person_custom_fields_type_check check (
  field_type in (
    'short_text','long_text','email','phone','number','date',
    'single_choice','multiple_choice','dropdown','yes_no'
  )
);

alter table public.form_fields drop constraint form_fields_type_check;
alter table public.form_fields add constraint form_fields_type_check check (
  field_type in (
    'short_text', 'long_text', 'email', 'phone', 'number', 'date',
    'single_choice', 'multiple_choice', 'dropdown', 'yes_no'
  )
);

do $rollback$
declare
  v_definition text;
  v_expected text := '''phone'', ''number'', ''date'', ''month_day'',' || chr(10) ||
    '         ''single_choice'', ''multiple_choice'', ''dropdown'', ''yes_no''';
  v_replacement text := '''phone'', ''number'', ''date'',' || chr(10) ||
    '         ''single_choice'', ''multiple_choice'', ''dropdown'', ''yes_no''';
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_managed_form'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_form_id uuid, p_actor_id uuid, p_title text, p_description text, p_fields jsonb';
  if v_definition is null or position(v_expected in v_definition) = 0 then
    raise exception 'save_managed_form definition drifted; rollback requires review';
  end if;
  execute pg_catalog.replace(v_definition, v_expected, v_replacement);
end;
$rollback$;

drop function private.is_valid_month_day(text);
drop trigger members_carry_partial_birthday_on_merge on public.members;
drop function public.carry_partial_birthday_on_member_merge();
drop trigger members_sync_birth_month_day on public.members;
drop function public.sync_member_birth_month_day();
alter table public.members
  drop constraint members_full_birth_date_matches_month_day_check,
  drop constraint members_birth_month_day_pair_check,
  drop column birth_day,
  drop column birth_month;
