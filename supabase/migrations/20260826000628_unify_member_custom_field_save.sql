-- Save standard member details and applicable custom fields atomically.
create or replace function public.update_member_with_custom_fields(
  p_member_id uuid,
  p_actor_id uuid,
  p_values jsonb,
  p_custom_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_role text;
  v_first_name text;
  v_last_name text;
  v_gender text;
  v_dob date;
  v_birth_month smallint;
  v_birth_day smallint;
  v_age_group text;
  v_department_id uuid;
begin
  if p_values is null or pg_catalog.jsonb_typeof(p_values) <> 'object'
     or p_custom_values is null or pg_catalog.jsonb_typeof(p_custom_values) <> 'array'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_values) supplied(key)
       where supplied.key not in (
         'first_name','last_name','email','phone','joined_at','notes','gender',
         'dob','birth_month','birth_day','age_group','address','baptized',
         'baptism_date','born_again','born_again_date','department_category_id'
       )
     ) then
    raise exception 'PERSON_UPDATE_INVALID';
  end if;

  select * into v_member
  from public.members m
  where m.id = p_member_id
  for update;
  if v_member.id is null or v_member.status = 'merged' or v_member.membership_stage <> 'member' then
    raise exception 'PERSON_TARGET_INVALID';
  end if;

  select uo.role into v_role
  from public.user_organizations uo
  where uo.organization_id = v_member.org_id and uo.user_id = p_actor_id;
  if v_role not in ('owner','admin','finance') then raise exception 'Forbidden'; end if;

  v_first_name := pg_catalog.btrim(coalesce(p_values->>'first_name', ''));
  v_last_name := pg_catalog.btrim(coalesce(p_values->>'last_name', ''));
  v_gender := pg_catalog.lower(pg_catalog.btrim(coalesce(p_values->>'gender', '')));
  v_age_group := nullif(pg_catalog.btrim(p_values->>'age_group'), '');
  if v_first_name = '' or v_last_name = '' or v_gender not in ('male','female')
     or (v_age_group is not null and v_age_group not in ('1-12','13-17','18-35','36+')) then
    raise exception 'PERSON_UPDATE_INVALID';
  end if;

  begin
    v_dob := nullif(p_values->>'dob', '')::date;
    v_birth_month := nullif(p_values->>'birth_month', '')::smallint;
    v_birth_day := nullif(p_values->>'birth_day', '')::smallint;
    v_department_id := nullif(p_values->>'department_category_id', '')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'PERSON_UPDATE_INVALID';
  end;

  if v_dob is not null and v_dob > current_date then raise exception 'PERSON_UPDATE_INVALID'; end if;
  if (v_birth_month is null) <> (v_birth_day is null)
     or (v_birth_month is not null and not private.is_valid_month_day(
       pg_catalog.lpad(v_birth_month::text, 2, '0') || '-' || pg_catalog.lpad(v_birth_day::text, 2, '0')
     )) then
    raise exception 'PERSON_UPDATE_INVALID';
  end if;
  if v_dob is null and v_birth_month is null and v_age_group is null then
    raise exception 'PERSON_UPDATE_INVALID';
  end if;

  if v_role = 'finance' and (
    v_first_name is distinct from v_member.first_name
    or v_last_name is distinct from v_member.last_name
    or v_gender is distinct from v_member.gender
    or v_age_group is distinct from v_member.age_group
  ) then
    raise exception 'FINANCE_IDENTITY_FIELDS_LOCKED';
  end if;

  if v_department_id is not null
     and v_department_id is distinct from v_member.department_category_id
     and not exists (
       select 1 from public.categories c
       where c.id = v_department_id and c.org_id = v_member.org_id
         and c.type = 'department' and c.status = 'active'
     ) then
    raise exception 'PERSON_UPDATE_INVALID';
  end if;

  update public.members m set
    first_name = v_first_name,
    last_name = v_last_name,
    email = nullif(pg_catalog.lower(pg_catalog.btrim(p_values->>'email')), ''),
    phone = nullif(pg_catalog.btrim(p_values->>'phone'), ''),
    joined_at = nullif(p_values->>'joined_at', '')::date,
    notes = nullif(pg_catalog.btrim(p_values->>'notes'), ''),
    gender = v_gender,
    dob = v_dob,
    birth_month = v_birth_month,
    birth_day = v_birth_day,
    age_group = v_age_group,
    segment = public.compute_segment(v_gender, v_age_group),
    address = nullif(pg_catalog.btrim(p_values->>'address'), ''),
    baptized = nullif(p_values->>'baptized', '')::boolean,
    baptism_date = nullif(p_values->>'baptism_date', '')::date,
    born_again = nullif(p_values->>'born_again', '')::boolean,
    born_again_date = nullif(p_values->>'born_again_date', '')::date,
    department_category_id = v_department_id,
    updated_by = p_actor_id,
    updated_at = pg_catalog.clock_timestamp()
  where m.id = v_member.id;

  perform public.update_person_custom_fields(v_member.id, p_actor_id, p_custom_values);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow
    or check_violation or foreign_key_violation then
    raise exception 'PERSON_UPDATE_INVALID';
end;
$$;

revoke all on function public.update_member_with_custom_fields(uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.update_member_with_custom_fields(uuid,uuid,jsonb,jsonb)
  to service_role;
