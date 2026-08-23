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
     or (p_field_type = 'month_day' and not private.is_valid_month_day(v_text))
     or (p_field_type in ('single_choice', 'dropdown') and not (p_options @> pg_catalog.jsonb_build_array(v_text)))
     or (p_field_type = 'yes_no' and pg_catalog.lower(v_text) not in ('yes', 'no')) then
    raise exception 'PERSON_CUSTOM_VALUE_INVALID';
  end if;
  return pg_catalog.to_jsonb(case when p_field_type = 'yes_no' then pg_catalog.lower(v_text) else v_text end);
end;
$$;
