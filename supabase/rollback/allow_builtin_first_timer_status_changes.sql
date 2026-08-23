drop trigger if exists form_revisions_keep_builtin_first_timer_active
  on public.form_revisions;
drop trigger if exists forms_keep_builtin_first_timer_active
  on public.forms;

drop function if exists public.force_builtin_first_timer_revision_active();
drop function if exists public.force_builtin_first_timer_active();

alter table public.forms
  drop constraint if exists forms_first_timer_active_check;

-- Existing forms remain active. This rollback restores the ability to close
-- them without rewriting their status or revision history.
