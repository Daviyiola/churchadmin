drop index if exists public.form_person_field_mappings_form_org_fk_idx;
drop index if exists public.form_person_field_mappings_custom_org_fk_idx;
drop index if exists public.person_custom_field_values_field_org_fk_idx;

create index if not exists form_person_field_mappings_custom_idx
  on public.form_person_field_mappings (custom_field_id)
  where custom_field_id is not null;
create index if not exists person_custom_field_values_field_idx
  on public.person_custom_field_values (custom_field_id);
