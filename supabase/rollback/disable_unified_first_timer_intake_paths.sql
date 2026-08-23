-- This rollback intentionally preserves form submissions and their source attribution.
-- It disables the unified campaign/personal entry points so deployed legacy routes can
-- be restored without losing inbox history.
revoke all on function public.submit_campaign_first_timer_form(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_personal_first_timer_form_context(text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_personal_first_timer_form(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
