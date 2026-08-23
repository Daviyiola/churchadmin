-- This rollback is safe only when every campaign-attributed submission still
-- references a campaign row.
do $$
begin
  if exists (
    select 1 from public.form_submissions
    where source_type = 'campaign' and source_campaign_id is null
  ) then
    raise exception 'Cannot restore the strict source constraint after an attributed campaign was deleted';
  end if;
end $$;

alter table public.form_submissions
  drop constraint form_submissions_source_campaign_check;
alter table public.form_submissions
  add constraint form_submissions_source_campaign_check
  check (
    (source_type = 'campaign' and source_campaign_id is not null)
    or (source_type <> 'campaign' and source_campaign_id is null)
  );
