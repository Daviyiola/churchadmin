-- Church Admin billing, onboarding, and capacity foundation.
-- Applying this migration does not enable Stripe or tax collection.

alter table public.organizations
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists creation_source text not null default 'legacy';

alter table public.organizations drop constraint if exists organizations_name_key;

alter table public.plan_entitlements
  add column if not exists member_count_limit integer,
  add column if not exists first_timer_count_limit integer,
  add column if not exists management_seat_limit integer;
alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_key_check;
alter table public.plan_entitlements add constraint plan_entitlements_plan_key_check
  check (plan_key in ('free','basic','growth','pro','enterprise'));

alter table public.plan_entitlements drop constraint if exists plan_entitlements_member_count_limit_check;
alter table public.plan_entitlements add constraint plan_entitlements_member_count_limit_check check (member_count_limit is null or member_count_limit > 0);
alter table public.plan_entitlements drop constraint if exists plan_entitlements_first_timer_count_limit_check;
alter table public.plan_entitlements add constraint plan_entitlements_first_timer_count_limit_check check (first_timer_count_limit is null or first_timer_count_limit > 0);
alter table public.plan_entitlements drop constraint if exists plan_entitlements_management_seat_limit_check;
alter table public.plan_entitlements add constraint plan_entitlements_management_seat_limit_check check (management_seat_limit is null or management_seat_limit > 0);

insert into public.plan_entitlements(plan_key,email_monthly_limit,form_count_limit,nikky_monthly_budget_cents,member_count_limit,first_timer_count_limit,management_seat_limit)
values
  ('free',100,2,50,40,40,2),
  ('basic',1000,10,300,200,200,5),
  ('growth',3000,40,800,750,750,30),
  ('pro',10000,100,2000,2500,2500,80),
  ('enterprise',2147483647,null,null,null,null,null)
on conflict (plan_key) do update set
  email_monthly_limit=excluded.email_monthly_limit,
  form_count_limit=excluded.form_count_limit,
  nikky_monthly_budget_cents=excluded.nikky_monthly_budget_cents,
  member_count_limit=excluded.member_count_limit,
  first_timer_count_limit=excluded.first_timer_count_limit,
  management_seat_limit=excluded.management_seat_limit,
  updated_at=now();

create table public.billing_plan_catalog (
  plan_key text primary key references public.plan_entitlements(plan_key) on update cascade,
  display_name text not null,
  description text not null,
  monthly_price_cents integer,
  annual_price_cents integer,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  public_available boolean not null default true,
  recommended boolean not null default false,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  check (monthly_price_cents is null or monthly_price_cents >= 0),
  check (annual_price_cents is null or annual_price_cents >= 0)
);

insert into public.billing_plan_catalog(plan_key,display_name,description,monthly_price_cents,annual_price_cents,public_available,recommended,sort_order)
values
 ('free','Free','For fellowships getting started',0,0,true,false,0),
 ('basic','Basic','For small churches building consistent operations',1900,19000,true,false,1),
 ('growth','Growth','For growing churches and ministry teams',3900,39000,true,true,2),
 ('pro','Pro','For larger churches with broader teams',5900,59000,true,false,3),
 ('enterprise','Enterprise','Custom scale and support',null,null,false,false,4)
on conflict (plan_key) do update set display_name=excluded.display_name,description=excluded.description,
 monthly_price_cents=excluded.monthly_price_cents,annual_price_cents=excluded.annual_price_cents,
 public_available=excluded.public_available,recommended=excluded.recommended,sort_order=excluded.sort_order,updated_at=now();

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null references public.plan_entitlements(plan_key),
  billing_interval text not null default 'none' check (billing_interval in ('none','monthly','annual')),
  status text not null check (status in ('free','founder_complimentary','incomplete','active','past_due','canceled','unpaid')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  scheduled_plan_key text references public.plan_entitlements(plan_key),
  scheduled_interval text check (scheduled_interval is null or scheduled_interval in ('monthly','annual')),
  founder_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.owner_onboarding_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null references public.plan_entitlements(plan_key),
  billing_interval text not null check (billing_interval in ('none','monthly','annual')),
  organization_name text,
  requested_slug text,
  status text not null default 'draft' check (status in ('draft','awaiting_verification','awaiting_checkout','processing','completed','expired','canceled')),
  stripe_checkout_session_id text unique,
  provisioned_organization_id uuid references public.organizations(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  attempts integer not null default 1,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.billing_plan_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_plan_key text,
  to_plan_key text,
  source text not null,
  stripe_event_id text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.form_submissions
  add column if not exists capacity_status text not null default 'not_applicable',
  add column if not exists capacity_reason text;
alter table public.form_submissions drop constraint if exists form_submissions_capacity_status_check;
alter table public.form_submissions add constraint form_submissions_capacity_status_check
  check (capacity_status in ('not_applicable','ready','capacity_pending','processed'));

-- Preserve public First Timers responses when visitor capacity is full. The
-- existing validator/snapshot behavior remains authoritative; only visitor
-- creation and automatic follow-ups are skipped.
do $capacity_patch$
declare v_sql text; v_original text;
begin
  select pg_get_functiondef('public.submit_public_form(text,uuid,jsonb)'::regprocedure) into v_sql;
  v_original:=v_sql;
  v_sql:=replace(v_sql,'  v_existing uuid;'||chr(10),'  v_existing uuid;'||chr(10)||'  v_capacity_pending boolean := false;'||chr(10));
  v_sql:=replace(v_sql,'    insert into public.members ('||chr(10),
    '    begin'||chr(10)||'      perform public.assert_organization_capacity(v_form.org_id, ''first_timers'', null);'||chr(10)||
    '    exception when others then'||chr(10)||'      if sqlerrm like ''PLAN_CAPACITY_REACHED:first_timers:%'' then v_capacity_pending := true; else raise; end if;'||chr(10)||
    '    end;'||chr(10)||'    if not v_capacity_pending then'||chr(10)||'    insert into public.members ('||chr(10));
  v_sql:=replace(v_sql,
    '    perform private.schedule_intake_followups('||chr(10)||'      v_form.org_id, v_member_id, v_first_name, v_last_name, v_email, v_now::date'||chr(10)||'    );'||chr(10),
    '    perform private.schedule_intake_followups('||chr(10)||'      v_form.org_id, v_member_id, v_first_name, v_last_name, v_email, v_now::date'||chr(10)||'    );'||chr(10)||'    end if;'||chr(10));
  v_sql:=replace(v_sql,
    '    form_snapshot, answers, result_member_id, submitted_at,'||chr(10)||'    reviewed_at'||chr(10),
    '    form_snapshot, answers, result_member_id, submitted_at,'||chr(10)||'    reviewed_at, capacity_status, capacity_reason'||chr(10));
  v_sql:=replace(v_sql,
    '    case when v_form.form_kind = ''first_timer'' then ''reviewed'' else ''new'' end,'||chr(10),
    '    case when v_form.form_kind = ''first_timer'' and not v_capacity_pending then ''reviewed'' else ''new'' end,'||chr(10));
  v_sql:=replace(v_sql,
    '    case when v_form.form_kind = ''first_timer'' then v_now else null end'||chr(10)||'  );',
    '    case when v_form.form_kind = ''first_timer'' and not v_capacity_pending then v_now else null end,'||chr(10)||
    '    case when v_capacity_pending then ''capacity_pending'' when v_form.form_kind = ''first_timer'' then ''processed'' else ''not_applicable'' end,'||chr(10)||
    '    case when v_capacity_pending then ''first_timer_limit_reached'' else null end'||chr(10)||'  );');
  v_sql:=replace(v_sql,
    '    ''visitor_created'', v_member_id is not null,'||chr(10),
    '    ''visitor_created'', v_member_id is not null,'||chr(10)||'    ''capacity_pending'', v_capacity_pending,'||chr(10));
  if v_sql=v_original or position('v_capacity_pending' in v_sql)=0 then raise exception 'Unable to patch submit_public_form capacity behavior'; end if;
  execute v_sql;
end $capacity_patch$;

create index if not exists owner_onboarding_intents_user_status_idx on public.owner_onboarding_intents(user_id,status);
create index if not exists organization_subscriptions_status_idx on public.organization_subscriptions(status,current_period_end);
create index if not exists billing_plan_events_org_created_idx on public.billing_plan_events(organization_id,created_at desc);
create index if not exists members_org_stage_status_capacity_idx on public.members(org_id,membership_stage,status);
create index if not exists invites_org_role_expiry_capacity_idx on public.invites(organization_id,role,expires_at) where used_at is null;

alter table public.billing_plan_catalog enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.owner_onboarding_intents enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.billing_plan_events enable row level security;

revoke all on public.billing_plan_catalog, public.organization_subscriptions, public.owner_onboarding_intents,
 public.stripe_webhook_events, public.billing_plan_events from public,anon,authenticated;
grant all on public.billing_plan_catalog, public.organization_subscriptions, public.owner_onboarding_intents,
 public.stripe_webhook_events, public.billing_plan_events to service_role;
grant usage,select on sequence public.billing_plan_events_id_seq to service_role;

create function public.effective_organization_plan(p_org_id uuid)
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

create function public.assert_organization_capacity(p_org_id uuid,p_resource text,p_exclude_invite_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_plan text; v_limit integer; v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_resource,0));
  v_plan := public.effective_organization_plan(p_org_id);
  select case p_resource when 'members' then member_count_limit when 'first_timers' then first_timer_count_limit
         when 'management_seats' then management_seat_limit when 'forms' then form_count_limit end
    into v_limit from public.plan_entitlements where plan_key=v_plan;
  if v_limit is null then return; end if;
  if p_resource='members' then
    select count(*) into v_used from public.members where org_id=p_org_id and membership_stage='member' and status='active';
  elsif p_resource='first_timers' then
    select count(*) into v_used from public.members where org_id=p_org_id and membership_stage='visitor' and status='active';
  elsif p_resource='forms' then
    select count(*) into v_used from public.forms where org_id=p_org_id and not is_system;
  elsif p_resource='management_seats' then
    select (select count(*) from public.user_organizations where organization_id=p_org_id and role in ('owner','admin','finance'))
      + (select count(*) from public.invites where organization_id=p_org_id and role in ('owner','admin','finance') and used_at is null
           and expires_at>now() and (p_exclude_invite_id is null or id<>p_exclude_invite_id)) into v_used;
  else raise exception 'Unknown capacity resource'; end if;
  if v_used >= v_limit then raise exception 'PLAN_CAPACITY_REACHED:%:%:%',p_resource,v_used,v_limit; end if;
end; $$;
revoke all on function public.assert_organization_capacity(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_organization_capacity(uuid,text,uuid) to service_role;

create function public.enforce_people_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_resource text;
begin
  if new.status<>'active' or new.membership_stage not in ('member','visitor') then return new; end if;
  if tg_op='UPDATE' and old.org_id=new.org_id and old.status='active' and old.membership_stage=new.membership_stage then return new; end if;
  v_resource:=case new.membership_stage when 'member' then 'members' else 'first_timers' end;
  perform public.assert_organization_capacity(new.org_id,v_resource,null); return new;
end; $$;
revoke all on function public.enforce_people_capacity() from public,anon,authenticated;
drop trigger if exists enforce_people_capacity_trigger on public.members;
create trigger enforce_people_capacity_trigger before insert or update of org_id,membership_stage,status on public.members
for each row execute function public.enforce_people_capacity();

create function public.enforce_form_capacity_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin if not new.is_system then perform public.assert_organization_capacity(new.org_id,'forms',null); end if; return new; end; $$;
revoke all on function public.enforce_form_capacity_trigger() from public,anon,authenticated;
drop trigger if exists enforce_form_capacity_trigger on public.forms;
create trigger enforce_form_capacity_trigger before insert on public.forms for each row execute function public.enforce_form_capacity_trigger();

create function public.enforce_management_seat_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role not in ('owner','admin','finance') then return new; end if;
  if tg_op='UPDATE' and old.organization_id=new.organization_id and old.role in ('owner','admin','finance') then return new; end if;
  perform public.assert_organization_capacity(new.organization_id,'management_seats',null); return new;
end; $$;
revoke all on function public.enforce_management_seat_capacity() from public,anon,authenticated;
drop trigger if exists enforce_management_seat_capacity_trigger on public.user_organizations;
create trigger enforce_management_seat_capacity_trigger before insert or update of organization_id,role on public.user_organizations
for each row execute function public.enforce_management_seat_capacity();

create function public.enforce_invite_seat_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.used_at is not null or new.expires_at<=now() or new.role not in ('owner','admin','finance') then return new; end if;
  if tg_op='UPDATE' and old.organization_id=new.organization_id and old.role in ('owner','admin','finance') and old.used_at is null and old.expires_at>now() then return new; end if;
  perform public.assert_organization_capacity(new.organization_id,'management_seats',case when tg_op='UPDATE' then old.id else null end); return new;
end; $$;
revoke all on function public.enforce_invite_seat_capacity() from public,anon,authenticated;
drop trigger if exists enforce_invite_seat_capacity_trigger on public.invites;
create trigger enforce_invite_seat_capacity_trigger before insert or update of organization_id,role,used_at,expires_at on public.invites
for each row execute function public.enforce_invite_seat_capacity();

create function public.protect_last_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_old_role text; v_new_role text;
begin
  v_org:=old.organization_id; v_old_role:=old.role; v_new_role:=case when tg_op='DELETE' then null else new.role end;
  if v_old_role='owner' and coalesce(v_new_role,'')<>'owner' and not exists(
    select 1 from public.user_organizations where organization_id=v_org and role='owner' and id<>old.id
  ) then raise exception 'LAST_OWNER_REQUIRED'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.protect_last_owner() from public,anon,authenticated;
drop trigger if exists protect_last_owner_trigger on public.user_organizations;
create trigger protect_last_owner_trigger before update of role or delete on public.user_organizations
for each row execute function public.protect_last_owner();

create function public.accept_organization_invite(p_token text,p_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_invite public.invites%rowtype; v_email text;
begin
 select * into v_invite from public.invites where token=p_token and used_at is null for update;
 if v_invite.id is null or v_invite.expires_at<=now() then raise exception 'INVITE_INVALID'; end if;
 select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;
 if v_email<>lower(v_invite.invited_email) then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
 update public.invites set used_at=now(),used_by=p_user_id where id=v_invite.id;
 insert into public.user_organizations(user_id,organization_id,role) values(p_user_id,v_invite.organization_id,v_invite.role)
 on conflict(user_id,organization_id) do update set role=excluded.role;
 return v_invite.organization_id;
end; $$;
revoke all on function public.accept_organization_invite(text,uuid) from public,anon,authenticated;
grant execute on function public.accept_organization_invite(text,uuid) to service_role;

create function public.provision_owner_organization(
  p_intent_id uuid,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_stripe_price_id text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_intent public.owner_onboarding_intents%rowtype; v_org_id uuid; v_slug text; v_suffix integer:=1;
begin
  select * into v_intent from public.owner_onboarding_intents where id=p_intent_id for update;
  if v_intent.id is null or v_intent.expires_at<=now() then raise exception 'ONBOARDING_INTENT_INVALID'; end if;
  if v_intent.provisioned_organization_id is not null then return v_intent.provisioned_organization_id; end if;
  if not exists(select 1 from auth.users where id=v_intent.user_id and email_confirmed_at is not null) then raise exception 'EMAIL_NOT_VERIFIED'; end if;
  if nullif(btrim(v_intent.organization_name),'') is null then raise exception 'ORGANIZATION_NAME_REQUIRED'; end if;
  if v_intent.plan_key='free' and exists(
    select 1 from public.organizations o join public.organization_subscriptions s on s.organization_id=o.id
    where o.created_by_user_id=v_intent.user_id and s.plan_key='free'
  ) then raise exception 'FREE_ORGANIZATION_LIMIT'; end if;
  v_slug:=coalesce(nullif(btrim(v_intent.requested_slug),''),'church');
  while exists(select 1 from public.organizations where slug=v_slug) loop
    v_suffix:=v_suffix+1; v_slug:=left(coalesce(nullif(btrim(v_intent.requested_slug),''),'church'),52)||'-'||v_suffix;
  end loop;
  insert into public.organizations(name,slug,created_by_user_id,creation_source)
  values(btrim(v_intent.organization_name),v_slug,v_intent.user_id,'self_service') returning id into v_org_id;
  insert into public.org_plans(organization_id,plan,updated_at) values(v_org_id,v_intent.plan_key,now())
  on conflict(organization_id) do update set plan=excluded.plan,updated_at=now();
  insert into public.organization_subscriptions(organization_id,plan_key,billing_interval,status,stripe_customer_id,
    stripe_subscription_id,stripe_price_id,current_period_start,current_period_end)
  values(v_org_id,v_intent.plan_key,v_intent.billing_interval,
    case when v_intent.plan_key='free' then 'free' else 'active' end,
    p_stripe_customer_id,p_stripe_subscription_id,p_stripe_price_id,p_period_start,p_period_end);
  insert into public.user_organizations(user_id,organization_id,role) values(v_intent.user_id,v_org_id,'owner');
  update public.owner_onboarding_intents set status='completed',provisioned_organization_id=v_org_id,updated_at=now() where id=v_intent.id;
  insert into public.billing_plan_events(organization_id,actor_user_id,event_type,to_plan_key,source,safe_metadata)
  values(v_org_id,v_intent.user_id,'organization_provisioned',v_intent.plan_key,'onboarding',jsonb_build_object('interval',v_intent.billing_interval));
  return v_org_id;
end; $$;
revoke all on function public.provision_owner_organization(uuid,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.provision_owner_organization(uuid,text,text,text,timestamptz,timestamptz) to service_role;

-- Existing organizations receive non-renewing Founder Pro for 12 months.
insert into public.organization_subscriptions(organization_id,plan_key,billing_interval,status,founder_ends_at)
select o.id,'pro','none','founder_complimentary',now()+interval '12 months' from public.organizations o
on conflict(organization_id) do nothing;
update public.org_plans set plan='pro',updated_at=now();

-- Deterministically establish an owner only where one does not already exist.
with candidates as (
  select uo.id,row_number() over(partition by uo.organization_id order by uo.created_at,uo.id) rn
  from public.user_organizations uo
  where uo.role='admin' and not exists(select 1 from public.user_organizations x where x.organization_id=uo.organization_id and x.role='owner')
)
update public.user_organizations uo set role='owner' from candidates c where c.id=uo.id and c.rn=1;
