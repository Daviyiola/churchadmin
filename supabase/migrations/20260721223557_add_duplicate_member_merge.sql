-- Atomic, audited duplicate-member consolidation.

alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check
  check (status = any (array['active'::text, 'archived'::text, 'merged'::text]));

alter table public.members
  add column if not exists merged_into_member_id uuid,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'members_merged_into_member_id_fkey'
      and conrelid = 'public.members'::regclass
  ) then
    alter table public.members
      add constraint members_merged_into_member_id_fkey
      foreign key (merged_into_member_id) references public.members(id)
      on delete restrict;
  end if;
end
$$;

alter table public.members drop constraint if exists members_merged_state_check;
alter table public.members
  add constraint members_merged_state_check check (
    (
      status = 'merged'
      and merged_into_member_id is not null
      and merged_at is not null
      and merged_by is not null
      and merged_into_member_id is distinct from id
    )
    or (
      status <> 'merged'
      and merged_into_member_id is null
      and merged_at is null
      and merged_by is null
    )
  );

create index if not exists members_merged_into_idx
  on public.members (merged_into_member_id)
  where merged_into_member_id is not null;

create table public.member_merges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  survivor_member_id uuid not null references public.members(id) on delete restrict,
  duplicate_member_id uuid not null references public.members(id) on delete restrict,
  canonical_member_id uuid not null references public.members(id) on delete restrict,
  survivor_name text not null,
  duplicate_name text not null,
  merged_by uuid not null,
  merged_by_email text,
  merged_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  field_sources jsonb not null default '{}'::jsonb,
  relationship_counts jsonb not null default '{}'::jsonb,
  constraint member_merges_distinct_members
    check (survivor_member_id <> duplicate_member_id)
);

create index member_merges_org_time_idx
  on public.member_merges (org_id, merged_at desc);
create index member_merges_canonical_idx
  on public.member_merges (canonical_member_id);

create table public.member_merge_audits (
  merge_id uuid primary key references public.member_merges(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_a_before jsonb not null,
  member_b_before jsonb not null,
  member_a_after jsonb not null,
  relationship_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index member_merge_audits_org_idx
  on public.member_merge_audits (org_id, created_at desc);

alter table public.member_merges enable row level security;
alter table public.member_merge_audits enable row level security;

create policy member_merges_select_org
  on public.member_merges for select to authenticated
  using ((select public.is_org_member(org_id)));

create policy member_merge_audits_select_admin
  on public.member_merge_audits for select to authenticated
  using ((select public.is_org_admin(org_id)));

revoke all on public.member_merges from public, anon, authenticated;
revoke all on public.member_merge_audits from public, anon, authenticated;
grant select on public.member_merges to authenticated;
grant select on public.member_merge_audits to authenticated;

-- Merged tombstones are not visible or mutable through ordinary member APIs.
drop policy if exists members_select_org on public.members;
create policy members_select_org
  on public.members for select to authenticated
  using ((select public.is_org_member(org_id)) and status <> 'merged');

drop policy if exists members_update_people_managers on public.members;
create policy members_update_people_managers
  on public.members for update to authenticated
  using (
    status <> 'merged'
    and (
      (select public.is_org_finance(org_id))
      or (
        membership_stage is distinct from 'member'
        and (select public.is_org_data_entry(org_id))
      )
    )
  )
  with check (
    status <> 'merged'
    and merged_into_member_id is null
    and merged_at is null
    and merged_by is null
    and (
      (select public.is_org_finance(org_id))
      or (
        membership_stage is distinct from 'member'
        and (select public.is_org_data_entry(org_id))
      )
    )
  );

drop policy if exists members_delete_admin on public.members;
create policy members_delete_admin
  on public.members for delete to authenticated
  using ((select public.is_org_admin(org_id)) and status <> 'merged');

drop policy if exists members_insert_org on public.members;
create policy members_insert_org
  on public.members for insert to authenticated
  with check (
    (select public.is_org_member(org_id))
    and created_by = (select auth.uid())
    and status <> 'merged'
    and merged_into_member_id is null
  );

drop policy if exists members_insert_data_entry on public.members;
create policy members_insert_data_entry
  on public.members for insert to authenticated
  with check (
    (select public.is_org_data_entry(org_id))
    and created_by = (select auth.uid())
    and status <> 'merged'
    and merged_into_member_id is null
  );

create or replace function public.reject_merged_member_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_canonical uuid;
begin
  if new.member_id is null then return new; end if;
  select m.merged_into_member_id into v_canonical
  from public.members m
  where m.id = new.member_id and m.status = 'merged';
  if found then
    raise exception 'This member was merged into %. Refresh and select the surviving member.', v_canonical;
  end if;
  return new;
end
$$;

revoke all on function public.reject_merged_member_reference() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'attendance_draft_members','attendance_entries','income_draft_items',
    'income_entries','income_import_rows','intake_tokens','scheduled_followups',
    'visitor_details','followup_emails','report_email_job_recipients'
  ] loop
    execute format('drop trigger if exists reject_merged_member_reference on public.%I', v_table);
    execute format(
      'create trigger reject_merged_member_reference before insert or update of member_id on public.%I for each row execute function public.reject_merged_member_reference()',
      v_table
    );
  end loop;
end
$$;

create unique index attendance_draft_members_session_member_key
  on public.attendance_draft_members (session_id, member_id);
create unique index attendance_entries_session_member_key
  on public.attendance_entries (session_id, member_id)
  where entry_source = 'member' and member_id is not null;

create or replace function public.preview_member_merge(
  p_member_a_id uuid,
  p_member_b_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a public.members%rowtype;
  v_b public.members%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_member_a_id is null or p_member_b_id is null or p_member_a_id = p_member_b_id then
    raise exception 'Select two different members';
  end if;

  select * into v_a from public.members where id = p_member_a_id;
  select * into v_b from public.members where id = p_member_b_id;
  if v_a.id is null or v_b.id is null then raise exception 'Member not found'; end if;
  if v_a.org_id <> v_b.org_id then raise exception 'Members must belong to the same organization'; end if;
  if not public.is_org_admin(v_a.org_id) then raise exception 'Admin or owner role required'; end if;
  if v_a.status = 'merged' or v_b.status = 'merged' then raise exception 'Merged records cannot be selected'; end if;
  if v_a.membership_stage <> 'member' or v_b.membership_stage <> 'member' then
    raise exception 'Both records must be members';
  end if;

  return jsonb_build_object(
    'member_a', to_jsonb(v_a),
    'member_b', to_jsonb(v_b),
    'relationships', jsonb_build_object(
      'income_draft_items', (select count(*) from public.income_draft_items where member_id in (v_a.id,v_b.id)),
      'income_entries', (select count(*) from public.income_entries where member_id in (v_a.id,v_b.id)),
      'income_import_rows', (select count(*) from public.income_import_rows where member_id in (v_a.id,v_b.id)),
      'attendance_draft_rows', (select count(*) from public.attendance_draft_members where member_id in (v_a.id,v_b.id)),
      'attendance_published_rows', (select count(*) from public.attendance_entries where member_id in (v_a.id,v_b.id)),
      'attendance_draft_overlaps', (select count(*) from public.attendance_draft_members a join public.attendance_draft_members b on b.session_id=a.session_id where a.member_id=v_a.id and b.member_id=v_b.id),
      'attendance_published_overlaps', (select count(*) from public.attendance_entries a join public.attendance_entries b on b.session_id=a.session_id and b.entry_source='member' where a.member_id=v_a.id and a.entry_source='member' and b.member_id=v_b.id),
      'scheduled_followups', (select count(*) from public.scheduled_followups where member_id in (v_a.id,v_b.id)),
      'followup_step_overlaps', (select count(*) from public.scheduled_followups a join public.scheduled_followups b on b.org_id=a.org_id and b.day_offset=a.day_offset where a.member_id=v_a.id and b.member_id=v_b.id and a.day_offset is not null),
      'followup_emails', (select count(*) from public.followup_emails where member_id in (v_a.id,v_b.id)),
      'intake_tokens', (select count(*) from public.intake_tokens where member_id in (v_a.id,v_b.id)),
      'report_recipients', (select count(*) from public.report_email_job_recipients where member_id in (v_a.id,v_b.id)),
      'visitor_details', (select count(*) from public.visitor_details where member_id in (v_a.id,v_b.id)),
      'prior_merges', (select count(*) from public.member_merges where canonical_member_id in (v_a.id,v_b.id))
    )
  );
end
$$;

revoke all on function public.preview_member_merge(uuid, uuid) from public, anon;
grant execute on function public.preview_member_merge(uuid, uuid) to authenticated;

create or replace function public.merge_members(
  p_member_a_id uuid,
  p_member_b_id uuid,
  p_use_b_fields text[],
  p_reason text,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a public.members%rowtype;
  v_b public.members%rowtype;
  v_after public.members%rowtype;
  v_merge_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_email text;
  v_allowed constant text[] := array[
    'first_name','last_name','email','phone','joined_at','address',
    'demographics','marital_status','children_count','baptism','born_again',
    'status','department_category_id'
  ];
  v_counts jsonb := '{}'::jsonb;
  v_manifest jsonb := '{}'::jsonb;
  v_removed_draft jsonb;
  v_removed_published jsonb;
  v_visitor_before jsonb;
  v_count integer;
  v_unknown text;
  v_final_department uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not coalesce(p_confirmed,false) then raise exception 'Irreversible merge confirmation is required'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'A merge reason is required'; end if;
  if p_member_a_id is null or p_member_b_id is null or p_member_a_id=p_member_b_id then
    raise exception 'Select two different members';
  end if;

  select x into v_unknown from unnest(coalesce(p_use_b_fields,'{}'::text[])) x
  where not (x = any(v_allowed)) limit 1;
  if v_unknown is not null then raise exception 'Unsupported field selection: %', v_unknown; end if;

  -- Fail closed if a future public member_id table is not handled here.
  select c.table_name into v_unknown
  from information_schema.columns c
  where c.table_schema='public' and c.column_name='member_id'
    and c.table_name <> all(array[
      'attendance_draft_members','attendance_entries','income_draft_items',
      'income_entries','income_import_rows','intake_tokens','scheduled_followups',
      'visitor_details','followup_emails','report_email_job_recipients'
    ])
  limit 1;
  if v_unknown is not null then raise exception 'Unhandled member relationship table: %', v_unknown; end if;

  perform 1 from public.members
  where id in (p_member_a_id,p_member_b_id)
  order by id for update;
  select * into v_a from public.members where id=p_member_a_id;
  select * into v_b from public.members where id=p_member_b_id;
  if v_a.id is null or v_b.id is null then raise exception 'Member not found'; end if;
  if v_a.org_id<>v_b.org_id then raise exception 'Members must belong to the same organization'; end if;
  if not public.is_org_admin(v_a.org_id) then raise exception 'Admin or owner role required'; end if;
  if v_a.status='merged' or v_b.status='merged' then raise exception 'Merged records cannot be selected'; end if;
  if v_a.membership_stage<>'member' or v_b.membership_stage<>'member' then raise exception 'Both records must be members'; end if;

  select coalesce(
    (select p.email from public.profiles p where p.id=auth.uid()),
    nullif(current_setting('request.jwt.claims',true)::jsonb->>'email','')
  ) into v_email;

  v_final_department := case
    when 'department_category_id'=any(coalesce(p_use_b_fields,'{}')) then v_b.department_category_id
    else coalesce(v_a.department_category_id,v_b.department_category_id)
  end;
  if v_final_department is not null and not exists (
    select 1 from public.categories c where c.id=v_final_department and c.org_id=v_a.org_id and c.type='department'
  ) then raise exception 'Selected department does not belong to this organization'; end if;

  select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into v_removed_draft
  from public.attendance_draft_members b
  where b.member_id=v_b.id and exists (
    select 1 from public.attendance_draft_members a where a.member_id=v_a.id and a.session_id=b.session_id
  );
  select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into v_removed_published
  from public.attendance_entries b
  where b.member_id=v_b.id and b.entry_source='member' and exists (
    select 1 from public.attendance_entries a where a.member_id=v_a.id and a.entry_source='member' and a.session_id=b.session_id
  );
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into v_visitor_before
  from public.visitor_details v where v.member_id in (v_a.id,v_b.id);

  update public.members m set
    first_name=case when 'first_name'=any(coalesce(p_use_b_fields,'{}')) then v_b.first_name else coalesce(nullif(btrim(v_a.first_name),''),v_b.first_name) end,
    last_name=case when 'last_name'=any(coalesce(p_use_b_fields,'{}')) then v_b.last_name else coalesce(nullif(btrim(v_a.last_name),''),v_b.last_name) end,
    email=case when 'email'=any(coalesce(p_use_b_fields,'{}')) then v_b.email else coalesce(nullif(btrim(v_a.email),''),v_b.email) end,
    phone=case when 'phone'=any(coalesce(p_use_b_fields,'{}')) then v_b.phone else coalesce(nullif(btrim(v_a.phone),''),v_b.phone) end,
    joined_at=case when 'joined_at'=any(coalesce(p_use_b_fields,'{}')) then v_b.joined_at else coalesce(v_a.joined_at,v_b.joined_at) end,
    address=case when 'address'=any(coalesce(p_use_b_fields,'{}')) then v_b.address else coalesce(nullif(btrim(v_a.address),''),v_b.address) end,
    gender=case when 'demographics'=any(coalesce(p_use_b_fields,'{}')) then v_b.gender else coalesce(v_a.gender,v_b.gender) end,
    dob=case when 'demographics'=any(coalesce(p_use_b_fields,'{}')) then v_b.dob else coalesce(v_a.dob,v_b.dob) end,
    age_group=case when 'demographics'=any(coalesce(p_use_b_fields,'{}')) then v_b.age_group else coalesce(v_a.age_group,v_b.age_group) end,
    marital_status=case when 'marital_status'=any(coalesce(p_use_b_fields,'{}')) then v_b.marital_status else coalesce(v_a.marital_status,v_b.marital_status) end,
    children_count=case when 'children_count'=any(coalesce(p_use_b_fields,'{}')) then v_b.children_count else coalesce(v_a.children_count,v_b.children_count) end,
    baptized=case when 'baptism'=any(coalesce(p_use_b_fields,'{}')) then v_b.baptized else coalesce(v_a.baptized,v_b.baptized) end,
    baptism_date=case when 'baptism'=any(coalesce(p_use_b_fields,'{}')) then v_b.baptism_date else coalesce(v_a.baptism_date,v_b.baptism_date) end,
    born_again=case when 'born_again'=any(coalesce(p_use_b_fields,'{}')) then v_b.born_again else coalesce(v_a.born_again,v_b.born_again) end,
    born_again_date=case when 'born_again'=any(coalesce(p_use_b_fields,'{}')) then v_b.born_again_date else coalesce(v_a.born_again_date,v_b.born_again_date) end,
    status=case when 'status'=any(coalesce(p_use_b_fields,'{}')) then v_b.status else v_a.status end,
    department_category_id=v_final_department,
    notes=case
      when nullif(btrim(v_a.notes),'') is null then v_b.notes
      when nullif(btrim(v_b.notes),'') is null or btrim(v_a.notes)=btrim(v_b.notes) then v_a.notes
      else v_a.notes||E'\n\n[Merged '||to_char(v_now,'YYYY-MM-DD')||' from '||btrim(v_b.first_name||' '||coalesce(v_b.last_name,''))||']\n'||v_b.notes
    end,
    updated_at=v_now,
    updated_by=auth.uid()
  where m.id=v_a.id;

  update public.members m set
    age_group=case when m.dob is null then m.age_group
      when extract(year from age(current_date,m.dob)) between 0 and 12 then '1-12'
      when extract(year from age(current_date,m.dob)) between 13 and 17 then '13-17'
      when extract(year from age(current_date,m.dob)) between 18 and 35 then '18-35'
      else '36+' end,
    baptism_date=case when m.baptized is true then m.baptism_date else null end,
    born_again_date=case when m.born_again is true then m.born_again_date else null end
  where m.id=v_a.id;
  update public.members m set
    segment=public.compute_segment(m.gender,m.age_group),
    profile_complete=(
      nullif(btrim(m.last_name),'') is not null and nullif(btrim(m.phone),'') is not null
      and m.gender in ('male','female') and m.age_group in ('1-12','13-17','18-35','36+')
      and public.compute_segment(m.gender,m.age_group) in ('men','women','boys','girls')
    )
  where m.id=v_a.id;

  delete from public.attendance_draft_members b where b.member_id=v_b.id and exists (
    select 1 from public.attendance_draft_members a where a.member_id=v_a.id and a.session_id=b.session_id
  ); get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('attendance_draft_deduplicated',v_count);
  update public.attendance_draft_members set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('attendance_draft_reassigned',v_count);

  delete from public.attendance_entries b where b.member_id=v_b.id and b.entry_source='member' and exists (
    select 1 from public.attendance_entries a where a.member_id=v_a.id and a.entry_source='member' and a.session_id=b.session_id
  ); get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('attendance_published_deduplicated',v_count);
  update public.attendance_entries set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('attendance_published_reassigned',v_count);

  update public.income_draft_items set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('income_draft_items',v_count);
  update public.income_entries set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('income_entries',v_count);
  update public.income_import_rows set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('income_import_rows',v_count);

  -- Let the higher-priority follow-up keep the configured step offset.
  update public.scheduled_followups a set day_offset=null, updated_at=v_now
  where a.member_id=v_a.id and a.day_offset is not null and exists (
    select 1 from public.scheduled_followups b
    where b.member_id=v_b.id and b.day_offset=a.day_offset
      and (case when b.status='sent' then 3 when b.status='pending' then 2 else 1 end)
        > (case when a.status='sent' then 3 when a.status='pending' then 2 else 1 end)
  );
  update public.scheduled_followups b set
    status=case when b.status='pending' then 'cancelled' else b.status end,
    cancelled_at=case when b.status='pending' then coalesce(b.cancelled_at,v_now) else b.cancelled_at end,
    day_offset=null,
    updated_at=v_now
  where b.member_id=v_b.id and b.day_offset is not null and exists (
    select 1 from public.scheduled_followups a
    where a.member_id=v_a.id and a.day_offset=b.day_offset
  );
  update public.scheduled_followups set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('scheduled_followups',v_count);

  update public.followup_emails set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('followup_emails',v_count);
  update public.report_email_job_recipients set member_id=v_a.id where member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('report_recipients',v_count);
  update public.intake_tokens set expires_at=least(expires_at,v_now)
  where member_id=v_b.id and used_at is null;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('intake_tokens_expired',v_count);

  if exists(select 1 from public.visitor_details where member_id=v_a.id)
     and exists(select 1 from public.visitor_details where member_id=v_b.id) then
    update public.visitor_details a set
      first_visit_at=coalesce(a.first_visit_at,b.first_visit_at),
      how_heard=coalesce(nullif(btrim(a.how_heard),''),b.how_heard),
      next_follow_up_at=coalesce(a.next_follow_up_at,b.next_follow_up_at),
      prayer_request_tags=array(select distinct x from unnest(coalesce(a.prayer_request_tags,'{}')||coalesce(b.prayer_request_tags,'{}')) x),
      follow_up_notes=case
        when nullif(btrim(a.follow_up_notes),'') is null then b.follow_up_notes
        when nullif(btrim(b.follow_up_notes),'') is null or btrim(a.follow_up_notes)=btrim(b.follow_up_notes) then a.follow_up_notes
        else a.follow_up_notes||E'\n\n[Merged visitor notes]\n'||b.follow_up_notes end,
      updated_at=v_now
    from public.visitor_details b where a.member_id=v_a.id and b.member_id=v_b.id;
    delete from public.visitor_details where member_id=v_b.id;
    v_counts:=v_counts||jsonb_build_object('visitor_details_combined',1);
  elsif exists(select 1 from public.visitor_details where member_id=v_b.id) then
    update public.visitor_details set member_id=v_a.id,updated_at=v_now where member_id=v_b.id;
    v_counts:=v_counts||jsonb_build_object('visitor_details_reassigned',1);
  end if;

  -- Point aliases from earlier merges directly at the new survivor.
  update public.members set merged_into_member_id=v_a.id where merged_into_member_id=v_b.id;
  get diagnostics v_count=row_count; v_counts:=v_counts||jsonb_build_object('prior_tombstones_repointed',v_count);
  update public.member_merges set canonical_member_id=v_a.id where canonical_member_id=v_b.id;

  update public.members set status='merged',merged_into_member_id=v_a.id,merged_at=v_now,merged_by=auth.uid(),updated_at=v_now,updated_by=auth.uid()
  where id=v_b.id;

  select * into v_after from public.members where id=v_a.id;
  v_manifest:=jsonb_build_object(
    'attendance_draft_removed',v_removed_draft,
    'attendance_published_removed',v_removed_published,
    'visitor_details_before',v_visitor_before
  );

  insert into public.member_merges(
    id,org_id,survivor_member_id,duplicate_member_id,canonical_member_id,
    survivor_name,duplicate_name,merged_by,merged_by_email,merged_at,reason,
    field_sources,relationship_counts
  ) values (
    v_merge_id,v_a.org_id,v_a.id,v_b.id,v_a.id,
    btrim(v_a.first_name||' '||coalesce(v_a.last_name,'')),
    btrim(v_b.first_name||' '||coalesce(v_b.last_name,'')),
    auth.uid(),v_email,v_now,btrim(p_reason),
    jsonb_build_object('use_b',coalesce(to_jsonb(p_use_b_fields),'[]'::jsonb)),v_counts
  );
  insert into public.member_merge_audits(
    merge_id,org_id,member_a_before,member_b_before,member_a_after,relationship_manifest
  ) values (v_merge_id,v_a.org_id,to_jsonb(v_a),to_jsonb(v_b),to_jsonb(v_after),v_manifest);

  return (select to_jsonb(mm) from public.member_merges mm where mm.id=v_merge_id);
end
$$;

revoke all on function public.merge_members(uuid,uuid,text[],text,boolean) from public, anon;
grant execute on function public.merge_members(uuid,uuid,text[],text,boolean) to authenticated;
