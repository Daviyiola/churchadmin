select
  (select count(*) from public.form_submissions) as submissions,
  (select count(*) from public.form_submissions where result_member_id is not null) as linked_submissions,
  (select count(*) from public.form_submissions s left join public.members m on m.id=s.result_member_id where s.result_member_id is not null and (m.id is null or m.org_id<>s.org_id)) as invalid_submission_people,
  (select count(*) from public.form_fields ff join public.forms f on f.id=ff.form_id left join private.form_field_integrations i on i.form_id=ff.form_id and i.field_key=ff.field_key where f.form_kind='first_timer' and i.field_key is null) as first_timer_custom_fields,
  (select count(*) from public.members where status='merged' and merged_into_member_id is null) as invalid_merged_tombstones;
