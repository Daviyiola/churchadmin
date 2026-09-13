-- Preserve the existing merge implementation while adding the relationships introduced
-- by forms, groups, SMS, and email. Unknown future member_id tables still fail closed.
do $repair$
declare
  v_sql text := pg_get_functiondef('public.merge_members(uuid,uuid,text[],text,boolean)'::regprocedure);
  v_old text := $old$'visitor_details','followup_emails','report_email_job_recipients'
    ])$old$;
  v_new text := $new$'visitor_details','followup_emails','report_email_job_recipients',
      'sms_contact_consents','sms_audience_snapshot_recipients',
      'communication_audience_snapshot_recipients','person_custom_field_values',
      'person_record_events','people_membership_events',
      -- These relationships are transferred by existing members merge triggers.
      'community_group_members','member_departments','email_contacts'
    ])$new$;
  v_anchor text := '  -- Point aliases from earlier merges directly at the new survivor.';
  v_relationships text := $relationships$
  -- Consent and reviewed destinations remain attached to their original phone/email.
  -- Only the member link changes; grants, revocations, addresses, and evidence survive.
  update public.sms_contact_consents set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('sms_contact_consents',v_count);
  update public.sms_audience_snapshot_recipients set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('sms_audience_snapshot_recipients',v_count);
  update public.communication_audience_snapshot_recipients set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('communication_audience_snapshot_recipients',v_count);

  -- Keep A's value on conflicts, retain B's original values in the restricted audit,
  -- and transfer every nonconflicting custom field.
  select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb)
  into v_manifest
  from public.person_custom_field_values f
  where f.member_id=v_b.id and f.org_id=v_a.org_id;
  v_manifest:=jsonb_build_object('duplicate_custom_fields_before',v_manifest);
  delete from public.person_custom_field_values b
  where b.member_id=v_b.id and b.org_id=v_a.org_id and exists (
    select 1 from public.person_custom_field_values a
    where a.member_id=v_a.id and a.custom_field_id=b.custom_field_id
  );
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('custom_fields_conflicts_preserved_in_audit',v_count);
  update public.person_custom_field_values set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('custom_fields_reassigned',v_count);

  update public.person_record_events set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('person_record_events',v_count);
  update public.people_membership_events set member_id=v_a.id
  where member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('people_membership_events',v_count);
  update public.form_submissions set result_member_id=v_a.id
  where result_member_id=v_b.id and org_id=v_a.org_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('form_submissions',v_count);

$relationships$;
begin
  if strpos(v_sql,v_old)=0 or strpos(v_sql,v_anchor)=0
     or strpos(v_sql,'v_manifest:=jsonb_build_object(')=0 then
    raise exception 'Unexpected merge_members definition; review migration before applying';
  end if;
  v_sql:=replace(v_sql,v_old,v_new);
  -- Preserve the custom-field evidence when the original attendance audit is assembled.
  v_sql:=replace(v_sql,'v_manifest:=jsonb_build_object(',
    'v_manifest:=v_manifest||jsonb_build_object(');
  v_sql:=replace(v_sql,v_anchor,v_relationships||v_anchor);
  execute v_sql;
end
$repair$;

-- member_merges uses duplicate_member_id, not merged_member_id. The old trigger
-- otherwise aborts every successful merge when it tries to attach group counts.
create or replace function public.attach_people_counts_to_member_merge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_counts public.member_merge_membership_counts%rowtype;
begin
  select * into v_counts from public.member_merge_membership_counts
  where source_member_id=new.duplicate_member_id and target_member_id=new.canonical_member_id;
  if v_counts.source_member_id is not null then
    update public.member_merges
    set relationship_counts=coalesce(relationship_counts,'{}'::jsonb)
      ||jsonb_build_object('community_groups',v_counts.community_groups,
                          'worker_departments',v_counts.worker_departments)
    where id=new.id;
    delete from public.member_merge_membership_counts
    where source_member_id=new.duplicate_member_id;
  end if;
  return new;
end $$;

revoke all on function public.attach_people_counts_to_member_merge() from public,anon,authenticated;
revoke all on function public.merge_members(uuid,uuid,text[],text,boolean) from public,anon;
grant execute on function public.merge_members(uuid,uuid,text[],text,boolean) to authenticated;
