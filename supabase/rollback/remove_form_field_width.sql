-- Safe post-use rollback: retain revision compatibility while disabling the
-- half-width option and normalizing every current field to one column.
update public.form_fields set layout_width = 'full';

alter table public.form_fields
  drop constraint if exists form_fields_layout_width_check;
alter table public.form_fields
  add constraint form_fields_layout_width_check
  check (layout_width = 'full');
