begin;

update public.organization_settings set nikky_enabled = false;

revoke all on table public.nikky_user_contexts from authenticated;
revoke all on table public.nikky_conversations from authenticated;
revoke all on table public.nikky_messages from authenticated;
revoke all on table public.nikky_report_confirmations from authenticated;
revoke all on table public.nikky_report_artifacts from authenticated;
revoke all on table public.schedule_coverage_requirements from authenticated;
revoke all on function public.upsert_schedule_coverage_requirement(uuid,date,uuid,uuid,public.schedule_role,integer) from authenticated;
revoke all on function public.delete_schedule_coverage_requirement(uuid) from authenticated;
revoke all on function public.acquire_nikky_request_slot(uuid,uuid,uuid) from service_role;
revoke all on function public.consume_nikky_rate_event(uuid,uuid,text,integer,integer,integer) from service_role;
revoke all on function public.increment_nikky_usage(uuid,uuid,date,bigint,bigint,bigint,integer,bigint) from service_role;

commit;
