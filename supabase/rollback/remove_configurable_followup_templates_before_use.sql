-- Safe only before organizations have saved custom follow-up templates.
do $$
begin
  if exists (select 1 from public.followup_automation_templates limit 1) then
    raise exception 'Rollback stopped: custom follow-up templates exist and would be lost.';
  end if;
end
$$;

drop function public.save_followup_automation_templates(uuid, jsonb);
drop table public.followup_automation_templates;
