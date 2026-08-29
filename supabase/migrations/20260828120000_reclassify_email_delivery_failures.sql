create or replace function public.reclassify_campaign_recipient_failure(
  p_provider_id text,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_campaign_id uuid;
begin
  if nullif(pg_catalog.btrim(coalesce(p_provider_id, '')), '') is null then
    return false;
  end if;

  select r.id, r.campaign_id
    into v_recipient_id, v_campaign_id
  from public.communication_campaign_recipients r
  where r.provider_id = p_provider_id
    and r.success = true
  order by r.created_at desc
  for update
  limit 1;

  if not found then
    return false;
  end if;

  update public.communication_campaign_recipients
  set success = false,
      error = left(coalesce(nullif(pg_catalog.btrim(p_error), ''), 'Provider reported a permanent delivery failure.'), 500)
  where id = v_recipient_id;

  update public.communication_campaigns
  set total_success = greatest(total_success - 1, 0),
      total_failure = total_failure + 1
  where id = v_campaign_id;

  update public.communication_audience_snapshot_recipients ar
  set success = false,
      outcome = 'failed',
      error = left(coalesce(nullif(pg_catalog.btrim(p_error), ''), 'Provider reported a permanent delivery failure.'), 500)
  from public.communication_audience_snapshots s
  where s.id = ar.snapshot_id
    and s.campaign_id = v_campaign_id
    and ar.provider_id = p_provider_id
    and ar.outcome = 'sent';

  return true;
end;
$$;

revoke all on function public.reclassify_campaign_recipient_failure(text, text) from public, anon, authenticated;
grant execute on function public.reclassify_campaign_recipient_failure(text, text) to service_role;
