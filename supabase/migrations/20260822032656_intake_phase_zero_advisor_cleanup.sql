create index intake_campaign_receipts_result_member_idx
  on private.intake_campaign_submission_receipts (result_member_id)
  where result_member_id is not null;

create policy "intake_rate_events_no_direct_access"
on private.intake_rate_events
for all
to public
using (false)
with check (false);

create policy "intake_campaign_receipts_no_direct_access"
on private.intake_campaign_submission_receipts
for all
to public
using (false)
with check (false);

drop policy if exists "intake_tokens_insert_manage" on public.intake_tokens;
create policy "intake_tokens_insert_manage"
on public.intake_tokens
for insert
to authenticated
with check (
  public.can_manage_followups(org_id)
  and created_by = (select auth.uid())
);

drop policy if exists "campaigns_insert_manage" on public.intake_campaigns;
create policy "campaigns_insert_manage"
on public.intake_campaigns
for insert
to authenticated
with check (
  public.can_manage_followups(org_id)
  and created_by = (select auth.uid())
);
