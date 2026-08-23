-- Preserve the existing atomic People processor as the base. This wrapper
-- resolves full DOBs and applies month/day-only birthdays in the same database
-- transaction, including the existing processing audit.
alter function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  rename to process_form_submission_to_person_base;

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
  v_values jsonb := p_standard_values;
  v_result jsonb;
  v_dob_text text := nullif(pg_catalog.btrim(p_standard_values->>'dob'), '');
  v_original_age_group text := nullif(pg_catalog.btrim(p_standard_values->>'age_group'), '');
  v_member_id uuid;
  v_member_before public.members%rowtype;
  v_month smallint;
  v_day smallint;
  v_full_dob date;
  v_age integer;
  v_derived_age_group text;
  v_partial boolean := false;
  v_used_temporary_age_group boolean := false;
  v_old_birthday text;
begin
  if p_standard_values is null or pg_catalog.jsonb_typeof(p_standard_values) <> 'object' then
    raise exception 'PERSON_PROCESSING_INVALID';
  end if;

  if p_action = 'update_person' and p_target_member_id is not null then
    select * into v_member_before
    from public.members m where m.id = p_target_member_id;
    if v_member_before.dob is not null then
      v_old_birthday := v_member_before.dob::text;
    elsif v_member_before.birth_month is not null then
      v_old_birthday := pg_catalog.lpad(v_member_before.birth_month::text, 2, '0') || '-' ||
        pg_catalog.lpad(v_member_before.birth_day::text, 2, '0');
    end if;
  end if;

  if v_dob_text is not null then
    if v_dob_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_full_dob := v_dob_text::date;
      exception when others then
        raise exception 'PERSON_PROCESSING_INVALID';
      end;
      if v_full_dob > current_date then
        raise exception 'PERSON_PROCESSING_INVALID';
      end if;
      v_age := extract(year from pg_catalog.age(current_date, v_full_dob))::integer;
      v_derived_age_group := case
        when v_age <= 12 then '1-12'
        when v_age <= 17 then '13-17'
        when v_age <= 35 then '18-35'
        else '36+'
      end;
      v_values := pg_catalog.jsonb_set(v_values, '{age_group}', pg_catalog.to_jsonb(v_derived_age_group));
    elsif private.is_valid_month_day(v_dob_text) then
      v_partial := true;
      v_month := substring(v_dob_text from 1 for 2)::smallint;
      v_day := substring(v_dob_text from 4 for 2)::smallint;
      v_values := v_values - 'dob';
      if p_action in ('create_member', 'create_visitor') and v_original_age_group is null then
        -- The legacy base validator requires an age group. This temporary value
        -- is cleared before commit, so it is never externally visible.
        v_values := pg_catalog.jsonb_set(v_values, '{age_group}', '"36+"'::jsonb);
        v_used_temporary_age_group := true;
      end if;
    else
      raise exception 'PERSON_PROCESSING_INVALID';
    end if;
  end if;

  v_result := public.process_form_submission_to_person_base(
    p_submission_id, p_actor_id, p_action, p_target_member_id,
    v_values, p_standard_mappings, p_custom_values
  );
  v_member_id := (v_result->>'member_id')::uuid;

  if v_partial then
    update public.members m
    set dob = null,
        birth_month = v_month,
        birth_day = v_day,
        age_group = case when v_used_temporary_age_group then null else m.age_group end,
        segment = case when v_used_temporary_age_group then null else m.segment end,
        profile_complete = case when v_used_temporary_age_group then false else m.profile_complete end
    where m.id = v_member_id;

    update public.person_record_events e
    set changes = pg_catalog.jsonb_set(
      case when v_used_temporary_age_group
        then e.changes #- '{standard,age_group}'
        else e.changes
      end,
      '{standard,dob}',
      pg_catalog.jsonb_build_object('old', v_old_birthday, 'new', v_dob_text),
      true
    )
    where e.source_submission_id = p_submission_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.process_form_submission_to_person_base(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  to service_role;
