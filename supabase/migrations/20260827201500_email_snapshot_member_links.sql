alter table public.communication_audience_snapshot_recipients
  add column member_id uuid references public.members(id) on delete set null;

create index communication_snapshot_recipients_member_idx
  on public.communication_audience_snapshot_recipients(org_id, member_id)
  where member_id is not null;
