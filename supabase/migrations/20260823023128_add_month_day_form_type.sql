alter table public.form_fields drop constraint form_fields_type_check;
alter table public.form_fields add constraint form_fields_type_check check (
  field_type in (
    'short_text','long_text','email','phone','number','date','month_day',
    'single_choice','multiple_choice','dropdown','yes_no'
  )
);

alter table public.person_custom_fields drop constraint person_custom_fields_type_check;
alter table public.person_custom_fields add constraint person_custom_fields_type_check check (
  field_type in (
    'short_text','long_text','email','phone','number','date','month_day',
    'single_choice','multiple_choice','dropdown','yes_no'
  )
);

create or replace function private.is_valid_month_day(p_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_value !~ '^[0-9]{2}-[0-9]{2}$' then false
    else
      substring(p_value from 1 for 2)::integer between 1 and 12
      and substring(p_value from 4 for 2)::integer between 1 and
        (array[31,29,31,30,31,30,31,31,30,31,30,31])[
          substring(p_value from 1 for 2)::integer
        ]
  end;
$$;

revoke all on function private.is_valid_month_day(text)
  from public, anon, authenticated, service_role;

create or replace function private.validate_month_day_form_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field jsonb;
  v_answer text;
begin
  for v_field in
    select value
    from pg_catalog.jsonb_array_elements(coalesce(new.form_snapshot->'fields', '[]'::jsonb))
    where value->>'type' = 'month_day'
  loop
    v_answer := pg_catalog.btrim(coalesce(new.answers->>(v_field->>'key'), ''));
    if v_answer <> '' and not private.is_valid_month_day(v_answer) then
      raise exception 'FORM_INVALID_FIELD';
    end if;
  end loop;
  return new;
end;
$$;

create trigger form_submissions_validate_month_day
before insert or update of answers, form_snapshot on public.form_submissions
for each row execute function private.validate_month_day_form_answers();

revoke all on function private.validate_month_day_form_answers()
  from public, anon, authenticated, service_role;
