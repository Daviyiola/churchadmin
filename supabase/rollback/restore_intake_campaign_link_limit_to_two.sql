-- Restores the previous two-link limit while retaining campaign management.
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text, 0)
  );

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
