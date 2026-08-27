create index sms_audience_snapshots_created_by_idx
  on public.sms_audience_snapshots(created_by);

create index sms_consent_attestations_attested_by_idx
  on public.sms_consent_attestations(attested_by);
create index sms_consent_attestations_revoked_by_idx
  on public.sms_consent_attestations(revoked_by);

create index sms_contact_consents_created_by_idx
  on public.sms_contact_consents(created_by);
create index sms_contact_consents_form_id_idx
  on public.sms_contact_consents(form_id);

create index sms_onboarding_drafts_updated_by_idx
  on public.sms_onboarding_drafts(updated_by);
create index sms_organization_settings_updated_by_idx
  on public.sms_organization_settings(updated_by);

create index sms_suppressions_released_by_idx
  on public.sms_suppressions(released_by);
create index sms_suppressions_suppressed_by_idx
  on public.sms_suppressions(suppressed_by);
