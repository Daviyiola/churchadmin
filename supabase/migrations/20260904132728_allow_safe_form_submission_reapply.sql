-- Allow a processed custom-form response to be deliberately applied again,
-- but only to the exact canonical person linked by its first processing.
-- Clearing and reprocessing happen in one transaction, so any downstream
-- validation or write failure restores the prior processing metadata.
create or replace function public.reapply_form_submission_to_person(
  p_submission_id uuid,
  p_actor_id uuid,
  p_standard_values jsonb,
  p_standard_mappings jsonb,
  p_custom_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.form_submissions%rowtype;
  v_form_kind text;
  v_role text;
  v_target_member_id uuid;
begin
  select * into v_submission
  from public.form_submissions s
  where s.id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'Submission not found';
  end if;

  select f.form_kind into v_form_kind
  from public.forms f
  where f.id = v_submission.form_id
    and f.org_id = v_submission.org_id;

  if v_form_kind is null then
    raise exception 'Form not found';
  end if;
  if v_form_kind = 'first_timer' then
    raise exception 'FIRST_TIMER_ALREADY_AUTOMATIC';
  end if;
  if v_submission.person_action is null
     or v_submission.result_member_id is null
     or v_submission.processed_at is null then
    raise exception 'SUBMISSION_NOT_PROCESSED';
  end if;

  select uo.role into v_role
  from public.user_organizations uo
  where uo.organization_id = v_submission.org_id
    and uo.user_id = p_actor_id;
  if v_role not in ('owner', 'admin', 'finance') then
    raise exception 'Forbidden';
  end if;

  v_target_member_id := v_submission.result_member_id;
  if not exists (
    select 1
    from public.members m
    where m.id = v_target_member_id
      and m.org_id = v_submission.org_id
      and m.status <> 'merged'
  ) then
    raise exception 'PERSON_TARGET_INVALID';
  end if;

  update public.form_submissions
  set result_member_id = null,
      person_action = null,
      processed_at = null,
      processed_by = null
  where id = v_submission.id;

  return public.process_form_submission_to_person(
    p_submission_id,
    p_actor_id,
    'update_person',
    v_target_member_id,
    p_standard_values,
    p_standard_mappings,
    p_custom_values
  );
end;
$$;

revoke all on function public.reapply_form_submission_to_person(uuid,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.reapply_form_submission_to_person(uuid,uuid,jsonb,jsonb,jsonb)
  to service_role;
