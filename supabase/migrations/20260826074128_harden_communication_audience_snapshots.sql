create index communication_audience_snapshots_created_by_idx
  on public.communication_audience_snapshots (created_by, expires_at desc);

create policy communication_audience_snapshots_service_only
  on public.communication_audience_snapshots
  for all to service_role
  using (true)
  with check (true);

create policy communication_audience_snapshot_recipients_service_only
  on public.communication_audience_snapshot_recipients
  for all to service_role
  using (true)
  with check (true);
