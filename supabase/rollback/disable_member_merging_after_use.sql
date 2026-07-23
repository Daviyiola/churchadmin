-- Safe rollback after merge events exist: stop future merges but retain data/audit.
begin;
revoke all on function public.preview_member_merge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.merge_members(uuid,uuid,text[],text,boolean) from public,anon,authenticated;
drop function if exists public.preview_member_merge(uuid,uuid);
drop function if exists public.merge_members(uuid,uuid,text[],text,boolean);
commit;
