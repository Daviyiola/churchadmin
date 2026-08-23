-- Expand the existing guarded save function's strict type allow-list while
-- preserving the complete deployed authorization and revision behavior.
do $migration$
declare
  v_definition text;
  v_expected text := '''phone'', ''number'', ''date'',' || chr(10) ||
    '         ''single_choice'', ''multiple_choice'', ''dropdown'', ''yes_no''';
  v_replacement text := '''phone'', ''number'', ''date'', ''month_day'',' || chr(10) ||
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
    raise exception 'save_managed_form definition drifted; review before enabling month_day';
  end if;
  execute pg_catalog.replace(v_definition, v_expected, v_replacement);
end;
$migration$;
