do $$
begin
  if exists (select 1 from public.form_submissions limit 1) then
    raise exception 'Phase 2 rollback refused because form submissions exist. Disable the feature and preserve response data instead.';
  end if;
end;
$$;

drop function if exists public.delete_empty_managed_form(uuid, uuid);
drop function if exists public.set_form_submission_status(uuid, uuid, text);
drop function if exists public.submit_public_form(text, uuid, jsonb);
drop trigger if exists form_fields_sync_first_timer_integration on public.form_fields;
drop function if exists public.sync_first_timer_field_integration();
drop table if exists public.form_submission_events;
drop table if exists public.form_submissions;
drop table if exists private.form_field_integrations;
