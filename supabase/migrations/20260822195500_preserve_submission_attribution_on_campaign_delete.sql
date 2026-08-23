alter table public.form_submissions
  drop constraint form_submissions_source_campaign_check;

alter table public.form_submissions
  add constraint form_submissions_source_campaign_check
  check (source_type = 'campaign' or source_campaign_id is null);

comment on constraint form_submissions_source_campaign_check on public.form_submissions is
  'Non-campaign submissions cannot reference a campaign. Campaign submissions retain their source label if the campaign link is later deleted.';
