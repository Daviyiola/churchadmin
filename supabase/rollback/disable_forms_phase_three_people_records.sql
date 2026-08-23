-- Safe after use: preserve people values and audit history, but disable new processing.
revoke all on function public.process_form_submission_to_person(uuid,uuid,text,uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.update_person_custom_fields(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
drop trigger if exists members_protect_identity_fields_from_finance on public.members;
drop trigger if exists form_submissions_apply_first_timer_to_person on public.form_submissions;
drop trigger if exists form_submissions_prepare_first_timer_person_link on public.form_submissions;
drop trigger if exists zz_form_fields_ensure_first_timer_person_mapping on public.form_fields;
