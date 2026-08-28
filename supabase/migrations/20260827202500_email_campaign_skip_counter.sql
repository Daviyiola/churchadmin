create or replace function public.increment_campaign_skipped(p_campaign_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.communication_campaigns
  set total_skipped = total_skipped + 1
  where id = p_campaign_id;
$$;

revoke all on function public.increment_campaign_skipped(uuid) from public, anon, authenticated;
grant execute on function public.increment_campaign_skipped(uuid) to service_role;
