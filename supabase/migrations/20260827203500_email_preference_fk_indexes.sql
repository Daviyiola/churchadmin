create index email_contacts_member_fk_idx
  on public.email_contacts(member_id) where member_id is not null;
create index email_preference_events_org_idx
  on public.email_preference_events(org_id, created_at desc);
create index email_preference_events_actor_idx
  on public.email_preference_events(actor_id) where actor_id is not null;
create index email_topic_preferences_changed_by_idx
  on public.email_topic_preferences(changed_by) where changed_by is not null;
create index email_global_suppressions_released_by_idx
  on public.email_global_suppressions(released_by) where released_by is not null;
