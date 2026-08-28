-- Conservative post-use rollback: disable merge coupling and restore the prior
-- scheduled-followup status constraint while preserving preference and suppression data.
drop trigger if exists members_repoint_email_contacts_after_merge on public.members;
drop function if exists private.repoint_merged_email_contacts();

update public.scheduled_followups
set status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, now()),
    error_message = coalesce(error_message, 'Email preference enforcement was rolled back.'),
    updated_at = now()
where status = 'blocked_preference';

alter table public.scheduled_followups drop constraint if exists scheduled_followups_status_check;
alter table public.scheduled_followups add constraint scheduled_followups_status_check check (
  status = any (array['pending','sent','failed','cancelled','blocked_quota'])
);

comment on table public.email_contacts is
  'Email preference feature disabled by rollback; retained to preserve recipient opt-outs.';
