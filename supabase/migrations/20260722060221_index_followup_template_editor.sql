create index followup_automation_templates_updated_by_idx
  on public.followup_automation_templates (updated_by)
  where updated_by is not null;
