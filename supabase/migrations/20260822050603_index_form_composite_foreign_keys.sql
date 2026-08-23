create index form_fields_form_org_idx
  on public.form_fields (form_id, org_id);

create index form_revisions_form_org_idx
  on public.form_revisions (form_id, org_id);
