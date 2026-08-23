drop index if exists private.intake_campaign_receipts_result_member_idx;

drop policy if exists "intake_rate_events_no_direct_access"
  on private.intake_rate_events;
drop policy if exists "intake_campaign_receipts_no_direct_access"
  on private.intake_campaign_submission_receipts;

drop policy if exists "intake_tokens_insert_manage" on public.intake_tokens;
create policy "intake_tokens_insert_manage"
on public.intake_tokens
for insert
to authenticated
with check (
  public.can_manage_followups(org_id)
  and created_by = auth.uid()
);

drop policy if exists "campaigns_insert_manage" on public.intake_campaigns;
create policy "campaigns_insert_manage"
on public.intake_campaigns
for insert
to authenticated
with check (
  public.can_manage_followups(org_id)
  and created_by = auth.uid()
);
