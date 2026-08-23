create or replace function public.complete_personal_intake(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_marital_status text,
  p_children_count integer,
  p_gender text,
  p_age_group text,
  p_how_heard text,
  p_prayer_request_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.intake_tokens%rowtype;
  v_member public.members%rowtype;
  v_first_visit date;
  v_scheduled integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_token
  from public.intake_tokens t
  where t.token = p_token
  for update;

  if v_token.token is null then raise exception 'INTAKE_INVALID'; end if;
  if v_token.used_at is not null then raise exception 'INTAKE_USED'; end if;
  if v_token.expires_at <= v_now then raise exception 'INTAKE_EXPIRED'; end if;

  select * into v_member
  from public.members m
  where m.id = v_token.member_id
    and m.org_id = v_token.org_id
  for update;

  if v_member.id is null or v_member.status = 'merged' then
    raise exception 'INTAKE_INVALID';
  end if;

  if nullif(pg_catalog.btrim(p_first_name), '') is null
     or nullif(pg_catalog.btrim(p_last_name), '') is null
     or p_gender not in ('male', 'female')
     or p_age_group not in ('1-12', '13-17', '18-35', '36+')
     or p_children_count is not null and p_children_count < 0
     or pg_catalog.lower(pg_catalog.btrim(p_email))
        is distinct from pg_catalog.lower(pg_catalog.btrim(v_token.invited_email)) then
    raise exception 'INTAKE_INVALID_FIELDS';
  end if;

  update public.members
  set first_name = pg_catalog.btrim(p_first_name),
      last_name = pg_catalog.btrim(p_last_name),
      email = pg_catalog.lower(pg_catalog.btrim(p_email)),
      phone = nullif(pg_catalog.btrim(coalesce(p_phone, '')), ''),
      address = nullif(pg_catalog.btrim(coalesce(p_address, '')), ''),
      marital_status = nullif(pg_catalog.btrim(coalesce(p_marital_status, '')), ''),
      children_count = p_children_count,
      gender = p_gender,
      age_group = p_age_group,
      segment = public.compute_segment(p_gender, p_age_group),
      membership_stage = 'visitor',
      profile_complete = nullif(pg_catalog.btrim(coalesce(p_phone, '')), '') is not null,
      updated_at = v_now
  where id = v_member.id;

  insert into public.visitor_details (
    member_id, first_visit_at, follow_up_status, how_heard,
    prayer_request_tags, next_follow_up_at, updated_at
  ) values (
    v_member.id, v_now::date, 'new',
    nullif(pg_catalog.btrim(coalesce(p_how_heard, '')), ''),
    p_prayer_request_tags, v_now::date + 3, v_now
  )
  on conflict (member_id) do update
  set first_visit_at = coalesce(public.visitor_details.first_visit_at, excluded.first_visit_at),
      how_heard = excluded.how_heard,
      prayer_request_tags = excluded.prayer_request_tags,
      next_follow_up_at = coalesce(public.visitor_details.next_follow_up_at, excluded.next_follow_up_at),
      updated_at = excluded.updated_at;

  select vd.first_visit_at into v_first_visit
  from public.visitor_details vd
  where vd.member_id = v_member.id;

  v_scheduled := private.schedule_intake_followups(
    v_token.org_id,
    v_member.id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    coalesce(v_first_visit, v_now::date)
  );

  update public.intake_tokens set used_at = v_now where token = v_token.token;

  return pg_catalog.jsonb_build_object(
    'member_id', v_member.id,
    'followups_scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.complete_personal_intake(
  text, text, text, text, text, text, text, integer, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.complete_personal_intake(
  text, text, text, text, text, text, text, integer, text, text, text, text[]
) to service_role;
