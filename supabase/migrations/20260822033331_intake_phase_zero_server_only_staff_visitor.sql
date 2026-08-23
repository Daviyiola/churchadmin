drop function if exists public.create_first_timer_visitor(
  uuid, text, text, text, text, text, text, text, text, integer,
  date, text, text[], text, date
);

create function public.create_first_timer_visitor(
  p_org_id uuid,
  p_actor_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_gender text,
  p_age_group text,
  p_address text,
  p_marital_status text,
  p_children_count integer,
  p_first_visit_at date,
  p_how_heard text,
  p_prayer_request_tags text[],
  p_follow_up_notes text,
  p_next_follow_up_at date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_first_visit date := coalesce(p_first_visit_at, current_date);
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_id is null or not exists (
    select 1
    from public.user_organizations uo
    where uo.organization_id = p_org_id
      and uo.user_id = p_actor_id
      and uo.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Only finance, admin, or owner can create first-timers';
  end if;

  if nullif(pg_catalog.btrim(p_first_name), '') is null
     or nullif(pg_catalog.btrim(p_last_name), '') is null
     or nullif(pg_catalog.btrim(p_phone), '') is null
     or p_gender not in ('male', 'female')
     or p_age_group not in ('1-12', '13-17', '18-35', '36+')
     or p_children_count is not null and p_children_count < 0
     or nullif(pg_catalog.btrim(coalesce(p_email, '')), '') is not null
        and p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid first-timer details';
  end if;

  insert into public.members (
    org_id, membership_stage, profile_complete, first_name, last_name,
    email, phone, gender, age_group, segment, address, marital_status,
    children_count, status, created_by, updated_by, created_at, updated_at
  ) values (
    p_org_id, 'visitor', true,
    pg_catalog.btrim(p_first_name), pg_catalog.btrim(p_last_name),
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), ''),
    pg_catalog.btrim(p_phone), p_gender, p_age_group,
    public.compute_segment(p_gender, p_age_group),
    nullif(pg_catalog.btrim(coalesce(p_address, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_marital_status, '')), ''),
    p_children_count, 'active', p_actor_id, p_actor_id, v_now, v_now
  ) returning id into v_member_id;

  insert into public.visitor_details (
    member_id, first_visit_at, follow_up_status, how_heard,
    prayer_request_tags, follow_up_notes, next_follow_up_at, updated_at
  ) values (
    v_member_id, v_first_visit, 'new',
    nullif(pg_catalog.btrim(coalesce(p_how_heard, '')), ''),
    p_prayer_request_tags,
    nullif(pg_catalog.btrim(coalesce(p_follow_up_notes, '')), ''),
    p_next_follow_up_at,
    v_now
  );

  perform private.schedule_intake_followups(
    p_org_id,
    v_member_id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), ''),
    v_first_visit
  );

  return v_member_id;
end;
$$;

revoke all on function public.create_first_timer_visitor(
  uuid, uuid, text, text, text, text, text, text, text, text, integer,
  date, text, text[], text, date
) from public, anon, authenticated;
grant execute on function public.create_first_timer_visitor(
  uuid, uuid, text, text, text, text, text, text, text, text, integer,
  date, text, text[], text, date
) to service_role;
