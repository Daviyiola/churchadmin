create function public.complete_capacity_pending_submission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.capacity_status='capacity_pending' and new.result_member_id is not null then
    new.capacity_status:='processed';
    new.capacity_reason:=null;
    new.status:='reviewed';
    new.reviewed_at:=coalesce(new.reviewed_at,now());
  end if;
  return new;
end; $$;
revoke all on function public.complete_capacity_pending_submission() from public,anon,authenticated;
drop trigger if exists complete_capacity_pending_submission_trigger on public.form_submissions;
create trigger complete_capacity_pending_submission_trigger
before update of result_member_id,person_action on public.form_submissions
for each row execute function public.complete_capacity_pending_submission();
