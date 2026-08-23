grant insert, update on table public.intake_campaigns to authenticated;

drop function if exists public.delete_intake_campaign_link(uuid, uuid);
drop function if exists public.update_intake_campaign_expiry(uuid, uuid, text, date);
drop function if exists public.create_intake_campaign_link(uuid, uuid, text, text, text, date);

drop trigger if exists intake_campaigns_sync_expiry_fields
  on public.intake_campaigns;
drop function if exists public.sync_intake_campaign_expiry_fields();
drop function if exists private.intake_campaign_expiration(uuid, text, date);
drop function if exists private.intake_campaign_timezone(uuid);

alter table public.intake_campaigns
  drop constraint if exists intake_campaigns_expiry_fields_check,
  drop constraint if exists intake_campaigns_expiry_mode_check,
  drop column if exists expires_on,
  drop column if exists expiry_mode;
