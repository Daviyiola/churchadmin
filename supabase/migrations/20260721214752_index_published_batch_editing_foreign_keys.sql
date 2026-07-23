-- Cover foreign-key paths introduced or exercised by published batch editing.

create index if not exists income_draft_batches_service_category_idx
  on public.income_draft_batches (service_category_id);

create index if not exists income_entries_batch_org_idx
  on public.income_entries (batch_id, org_id);

create index if not exists attendance_entries_session_org_idx
  on public.attendance_entries (session_id, org_id);

create index if not exists income_batch_edits_old_service_idx
  on public.income_batch_edits (old_service_category_id);

create index if not exists income_batch_edits_new_service_idx
  on public.income_batch_edits (new_service_category_id);

create index if not exists attendance_session_edits_old_service_idx
  on public.attendance_session_edits (old_service_category_id);

create index if not exists attendance_session_edits_new_service_idx
  on public.attendance_session_edits (new_service_category_id);
