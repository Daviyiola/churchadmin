create index form_person_field_mappings_form_org_fk_idx
  on public.form_person_field_mappings (form_id, org_id);
create index form_person_field_mappings_custom_org_fk_idx
  on public.form_person_field_mappings (custom_field_id, org_id)
  where custom_field_id is not null;
create index person_custom_field_values_field_org_fk_idx
  on public.person_custom_field_values (custom_field_id, org_id);

drop index if exists public.form_person_field_mappings_custom_idx;
drop index if exists public.person_custom_field_values_field_idx;
