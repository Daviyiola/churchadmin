begin;

create table public.nikky_active_requests (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
create index nikky_active_requests_org_idx on public.nikky_active_requests(organization_id, expires_at);
create index nikky_active_requests_user_idx on public.nikky_active_requests(user_id, expires_at);
alter table public.nikky_active_requests enable row level security;
revoke all on table public.nikky_active_requests from public, anon, authenticated;

create or replace function public.acquire_nikky_request_slot(p_request_id uuid, p_organization_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 718));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 719));
  delete from public.nikky_active_requests where expires_at <= now();
  if (select count(*) from public.nikky_active_requests where user_id=p_user_id) >= 2 then raise exception 'user_concurrency_limit'; end if;
  if (select count(*) from public.nikky_active_requests where organization_id=p_organization_id) >= 8 then raise exception 'organization_concurrency_limit'; end if;
  insert into public.nikky_active_requests(request_id,organization_id,user_id,expires_at) values(p_request_id,p_organization_id,p_user_id,now()+interval '2 minutes');
end;$$;

create or replace function public.release_nikky_request_slot(p_request_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  delete from public.nikky_active_requests where request_id=p_request_id;
$$;

create or replace function public.consume_nikky_rate_event(p_organization_id uuid,p_user_id uuid,p_event_type text,p_window_seconds integer,p_user_limit integer,p_org_limit integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_since timestamptz;
begin
  if p_event_type not in ('chat','report') or p_window_seconds<1 or p_user_limit<1 or p_org_limit<1 then raise exception 'invalid_rate_policy'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_event_type,720));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||p_event_type,721));
  v_since:=now()-make_interval(secs=>p_window_seconds);
  if (select count(*) from public.nikky_rate_events where user_id=p_user_id and event_type=p_event_type and occurred_at>=v_since)>=p_user_limit then raise exception 'user_rate_limit'; end if;
  if (select count(*) from public.nikky_rate_events where organization_id=p_organization_id and event_type=p_event_type and occurred_at>=v_since)>=p_org_limit then raise exception 'organization_rate_limit'; end if;
  insert into public.nikky_rate_events(organization_id,user_id,event_type) values(p_organization_id,p_user_id,p_event_type);
end;$$;

create or replace function public.increment_nikky_usage(p_organization_id uuid,p_user_id uuid,p_usage_month date,p_input bigint,p_cached bigint,p_output bigint,p_tool_calls integer,p_cost bigint)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.nikky_usage_monthly(organization_id,user_id,usage_month,request_count,tool_call_count,input_tokens,cached_input_tokens,output_tokens,estimated_cost_micros)
  values(p_organization_id,p_user_id,p_usage_month,1,p_tool_calls,p_input,p_cached,p_output,p_cost)
  on conflict(organization_id,user_id,usage_month) do update set request_count=nikky_usage_monthly.request_count+1,tool_call_count=nikky_usage_monthly.tool_call_count+excluded.tool_call_count,input_tokens=nikky_usage_monthly.input_tokens+excluded.input_tokens,cached_input_tokens=nikky_usage_monthly.cached_input_tokens+excluded.cached_input_tokens,output_tokens=nikky_usage_monthly.output_tokens+excluded.output_tokens,estimated_cost_micros=nikky_usage_monthly.estimated_cost_micros+excluded.estimated_cost_micros,updated_at=now();
$$;

revoke all on function public.acquire_nikky_request_slot(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_nikky_request_slot(uuid) from public,anon,authenticated;
revoke all on function public.consume_nikky_rate_event(uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.increment_nikky_usage(uuid,uuid,date,bigint,bigint,bigint,integer,bigint) from public,anon,authenticated;
grant execute on function public.acquire_nikky_request_slot(uuid,uuid,uuid) to service_role;
grant execute on function public.release_nikky_request_slot(uuid) to service_role;
grant execute on function public.consume_nikky_rate_event(uuid,uuid,text,integer,integer,integer) to service_role;
grant execute on function public.increment_nikky_usage(uuid,uuid,date,bigint,bigint,bigint,integer,bigint) to service_role;

commit;
