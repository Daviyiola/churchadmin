alter table public.intake_campaigns
  add column expiry_mode text not null default 'date',
  add column expires_on date;

update public.intake_campaigns c
set expires_on = (
  c.expires_at at time zone coalesce(
    (select os.timezone_name
     from public.organization_settings os
     where os.organization_id = c.org_id),
    (select fs.timezone_name
     from public.followup_settings fs
     where fs.org_id = c.org_id),
    'UTC'
  )
)::date
where c.expires_at is not null;

alter table public.intake_campaigns
  add constraint intake_campaigns_expiry_mode_check
    check (expiry_mode in ('never', 'date')),
  add constraint intake_campaigns_expiry_fields_check
    check (
      (expiry_mode = 'never' and expires_on is null)
      or
      (expiry_mode = 'date' and expires_on is not null)
    );

create or replace function private.intake_campaign_timezone(p_org_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select os.timezone_name
     from public.organization_settings os
     where os.organization_id = p_org_id),
    (select fs.timezone_name
     from public.followup_settings fs
     where fs.org_id = p_org_id),
    'UTC'
  );
$$;

revoke all on function private.intake_campaign_timezone(uuid)
  from public, anon, authenticated;

create or replace function private.intake_campaign_expiration(
  p_org_id uuid,
  p_expiry_mode text,
  p_expires_on date
)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_timezone text := private.intake_campaign_timezone(p_org_id);
  v_today date := (pg_catalog.clock_timestamp() at time zone v_timezone)::date;
begin
  if p_expiry_mode = 'never' then
    if p_expires_on is not null then raise exception 'Never-expiring links cannot include a date'; end if;
    return pg_catalog.clock_timestamp() + interval '9999 days';
  end if;

  if p_expiry_mode <> 'date' or p_expires_on is null then
    raise exception 'Choose an expiration date';
  end if;
  if p_expires_on < v_today then
    raise exception 'Expiration date cannot be in the past';
  end if;

  -- The link remains usable throughout the selected organization-local date.
  return ((p_expires_on + 1)::timestamp at time zone v_timezone);
end;
$$;

revoke all on function private.intake_campaign_expiration(uuid, text, date)
  from public, anon, authenticated;

create or replace function public.sync_intake_campaign_expiry_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if new.expiry_mode = 'never' then
    new.expires_on := null;
    if new.expires_at is null then
      new.expires_at := pg_catalog.clock_timestamp() + interval '9999 days';
    end if;
    return new;
  end if;

  if new.expires_on is not null then
    new.expires_at := private.intake_campaign_expiration(
      new.org_id, 'date', new.expires_on
    );
    return new;
  end if;

  if new.expires_at is null then raise exception 'Choose an expiration date'; end if;
  v_timezone := private.intake_campaign_timezone(new.org_id);
  new.expires_on := (new.expires_at at time zone v_timezone)::date;
  return new;
end;
$$;

revoke all on function public.sync_intake_campaign_expiry_fields()
  from public, anon, authenticated;

create trigger intake_campaigns_sync_expiry_fields
before insert or update of org_id, expiry_mode, expires_on, expires_at
on public.intake_campaigns
for each row execute function public.sync_intake_campaign_expiry_fields();

create or replace function public.create_intake_campaign_link(
  p_org_id uuid,
  p_actor_id uuid,
  p_name text,
  p_slug text,
  p_expiry_mode text,
  p_expires_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.intake_campaigns%rowtype;
  v_expires_at timestamptz;
begin
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;

  if nullif(pg_catalog.btrim(p_name), '') is null
     or char_length(pg_catalog.btrim(p_name)) > 120
     or nullif(pg_catalog.btrim(p_slug), '') is null
     or char_length(p_slug) > 80 then
    raise exception 'Invalid campaign details';
  end if;

  if (
    select count(*)
    from public.intake_campaigns c
    where c.org_id = p_org_id
      and c.is_active
      and (c.expires_at is null or c.expires_at > pg_catalog.clock_timestamp())
  ) >= 2 then
    raise exception 'Limit reached: max 2 active multiple-visitor links per organization';
  end if;

  v_expires_at := private.intake_campaign_expiration(
    p_org_id, p_expiry_mode, p_expires_on
  );

  insert into public.intake_campaigns (
    org_id, name, slug, expiry_mode, expires_on, expires_at,
    is_active, created_by
  ) values (
    p_org_id, pg_catalog.btrim(p_name), pg_catalog.btrim(p_slug),
    p_expiry_mode, p_expires_on, v_expires_at, true, p_actor_id
  ) returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'id', v_row.id,
    'slug', v_row.slug,
    'expiry_mode', v_row.expiry_mode,
    'expires_on', v_row.expires_on,
    'expires_at', v_row.expires_at
  );
end;
$$;

revoke all on function public.create_intake_campaign_link(
  uuid, uuid, text, text, text, date
) from public, anon, authenticated;
grant execute on function public.create_intake_campaign_link(
  uuid, uuid, text, text, text, date
) to service_role;

create or replace function public.update_intake_campaign_expiry(
  p_campaign_id uuid,
  p_actor_id uuid,
  p_expiry_mode text,
  p_expires_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.intake_campaigns%rowtype;
  v_expires_at timestamptz;
begin
  select * into v_campaign
  from public.intake_campaigns c
  where c.id = p_campaign_id
  for update;

  if v_campaign.id is null then raise exception 'Campaign not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_campaign.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;

  v_expires_at := private.intake_campaign_expiration(
    v_campaign.org_id, p_expiry_mode, p_expires_on
  );

  update public.intake_campaigns
  set expiry_mode = p_expiry_mode,
      expires_on = p_expires_on,
      expires_at = v_expires_at
  where id = p_campaign_id
  returning * into v_campaign;

  return pg_catalog.jsonb_build_object(
    'id', v_campaign.id,
    'expiry_mode', v_campaign.expiry_mode,
    'expires_on', v_campaign.expires_on,
    'expires_at', v_campaign.expires_at
  );
end;
$$;

revoke all on function public.update_intake_campaign_expiry(
  uuid, uuid, text, date
) from public, anon, authenticated;
grant execute on function public.update_intake_campaign_expiry(
  uuid, uuid, text, date
) to service_role;

create or replace function public.delete_intake_campaign_link(
  p_campaign_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.intake_campaigns%rowtype;
begin
  select * into v_campaign
  from public.intake_campaigns c
  where c.id = p_campaign_id
  for update;

  if v_campaign.id is null then raise exception 'Campaign not found'; end if;
  if not exists (
    select 1 from public.user_organizations uo
    where uo.organization_id = v_campaign.org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then raise exception 'Forbidden'; end if;

  delete from public.intake_campaigns where id = p_campaign_id;
  return p_campaign_id;
end;
$$;

revoke all on function public.delete_intake_campaign_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_intake_campaign_link(uuid, uuid)
  to service_role;

revoke insert, update, delete on table public.intake_campaigns
  from authenticated;
