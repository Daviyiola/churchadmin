create or replace function public.effective_organization_plan(p_org_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when s.status='founder_complimentary' and s.founder_ends_at > now() then 'pro'
    when s.status='founder_complimentary' then 'free'
    when s.status='free' then 'free'
    when s.status='active' then s.plan_key
    when s.status='past_due' and s.grace_ends_at > now() then s.plan_key
    when s.status in ('past_due','canceled','unpaid','incomplete') then 'free'
    else coalesce((select case when lower(op.plan) in ('free','basic','growth','pro','enterprise') then lower(op.plan) else 'basic' end
                   from public.org_plans op where op.organization_id=p_org_id),'basic')
  end
  from (select 1) seed left join public.organization_subscriptions s on s.organization_id=p_org_id;
$$;
revoke all on function public.effective_organization_plan(uuid) from public,anon,authenticated;
grant execute on function public.effective_organization_plan(uuid) to service_role;
