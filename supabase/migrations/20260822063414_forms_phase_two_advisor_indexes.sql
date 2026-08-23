create index form_submissions_form_org_fk_idx
  on public.form_submissions (form_id, org_id);

create index form_submissions_form_revision_fk_idx
  on public.form_submissions (form_id, form_revision);

create index form_submission_events_composite_fk_idx
  on public.form_submission_events (submission_id, form_id, org_id);
