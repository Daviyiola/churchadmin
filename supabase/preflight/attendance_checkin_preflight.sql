select 'cross_org_draft_members' check_name,count(*) issue_count from public.attendance_draft_members d join public.attendance_sessions s on s.id=d.session_id join public.members m on m.id=d.member_id where d.org_id<>s.org_id or d.org_id<>m.org_id
union all select 'cross_org_headcounts',count(*) from public.attendance_draft_headcounts d join public.attendance_sessions s on s.id=d.session_id where d.org_id<>s.org_id
union all select 'invalid_services',count(*) from public.attendance_sessions s left join public.categories c on c.id=s.service_category_id and c.org_id=s.org_id where c.id is null or c.type<>'services'
union all select 'merged_or_archived_draft_members',count(*) from public.attendance_draft_members d join public.members m on m.id=d.member_id where m.status<>'active'
union all select 'missing_demographics',count(*) from public.members where membership_stage='member' and status='active' and (gender is null or age_group is null)
union all select 'published_parent_mismatch',count(*) from public.attendance_entries e join public.attendance_sessions s on s.id=e.session_id where e.org_id<>s.org_id or e.service_category_id<>s.service_category_id or e.session_date<>s.session_date
union all select 'organizations_without_confirmed_timezone',count(*) from public.organizations o left join public.organization_settings s on s.organization_id=o.id where s.timezone_name is null or not coalesce(s.timezone_confirmed,false);

select org_id,lower(regexp_replace(btrim(first_name||' '||coalesce(last_name,'')),'\\s+',' ','g')) normalized_name,count(*)
from public.members where status in ('active','archived') and membership_stage='member'
group by org_id,normalized_name having count(*)>1 order by count(*) desc;

