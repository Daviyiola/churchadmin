-- Run after the repair. Uses synthetic archived members; the inner subtransaction
-- intentionally rolls back every insert/update, including the merge audit.
do $verify$
declare
  v_org uuid;
  v_actor uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_result jsonb;
  v_verified boolean := false;
begin
  select organization_id,user_id into v_org,v_actor
  from public.user_organizations
  where role in ('owner','admin')
  order by organization_id,user_id limit 1;
  if v_org is null then raise exception 'No administrator organization available for verification'; end if;
  begin
    perform set_config('request.jwt.claim.sub',v_actor::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
    insert into public.members(id,org_id,first_name,last_name,phone,gender,age_group,membership_stage,status,created_by)
    values (v_a,v_org,'Merge verification','Temporary A','+12125550123','female','36+','member','archived',v_actor),
           (v_b,v_org,'Merge verification','Temporary B','+12125550124','female','36+','member','archived',v_actor);
    v_result := public.merge_members(v_a,v_b,'{}'::text[],'Temporary rollback-only verification',true);
    if v_result->>'canonical_member_id' <> v_a::text
       or not exists(select 1 from public.members where id=v_b and status='merged' and merged_into_member_id=v_a)
       or not exists(select 1 from public.member_merge_audits where merge_id=(v_result->>'id')::uuid)
       or not (v_result->'relationship_counts' ? 'sms_contact_consents')
       or not (v_result->'relationship_counts' ? 'community_groups') then
      raise exception 'Merge verification assertions failed';
    end if;
    v_verified:=true;
    raise exception using errcode='PZ001',message='Rollback synthetic merge verification';
  exception when sqlstate 'PZ001' then null;
  end;
  if not v_verified or exists(select 1 from public.members where id in(v_a,v_b))
     or exists(select 1 from public.member_merges where duplicate_member_id=v_b) then
    raise exception 'Synthetic verification rollback failed';
  end if;
end $verify$;
select 'Live merge and audit verified; synthetic records rolled back' as verification,
has_function_privilege('anon','public.merge_members(uuid,uuid,text[],text,boolean)','execute') as anon_can_merge,
has_function_privilege('authenticated','public.merge_members(uuid,uuid,text[],text,boolean)','execute') as signed_in_can_call;
