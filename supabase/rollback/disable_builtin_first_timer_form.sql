-- Safe rollback after built-in forms may have received future submissions.
-- Preserve form and revision data while disabling automatic provisioning and locks.

drop trigger if exists user_organizations_provision_first_timer_form
  on public.user_organizations;
drop trigger if exists forms_prevent_builtin_delete
  on public.forms;

drop function if exists public.provision_builtin_first_timer_form();
drop function if exists public.prevent_builtin_form_delete();

update public.form_fields
set is_locked = false
where is_locked;

update public.forms
set form_kind = 'generic',
    is_system = false
where form_kind = 'first_timer';

drop index if exists public.forms_one_first_timer_per_org;

alter table public.forms
  drop constraint if exists forms_first_timer_is_system_check;

-- Columns and provisioning function intentionally remain because the current
-- server RPC definitions reference them. A destructive pre-use rollback may
-- remove them only after restoring the earlier RPC definitions.
