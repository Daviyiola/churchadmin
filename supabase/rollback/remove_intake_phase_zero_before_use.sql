-- Use only with the matching application-code rollback.

drop function if exists public.create_campaign_intake_visitor(
  text, uuid, text, text, text, text, text, text, integer, text, text, text, text[]
);
drop function if exists public.complete_personal_intake(
  text, text, text, text, text, text, text, integer, text, text, text, text[]
);
drop function if exists public.create_personal_intake_invitation(
  uuid, uuid, text, text, text, timestamptz
);
drop function if exists public.consume_intake_rate_limit(text, text, integer, integer);
drop function if exists private.schedule_intake_followups(uuid, uuid, text, text, text, date);
drop function if exists private.render_intake_template(text, text, text, text);

drop table if exists private.intake_campaign_submission_receipts;
drop table if exists private.intake_rate_events;

drop index if exists public.intake_campaigns_org_id_idx;

grant execute on function public.intake_token_lookup(text) to anon, authenticated;
grant execute on function public.intake_token_consume(text) to anon, authenticated;

