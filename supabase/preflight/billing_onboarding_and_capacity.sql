select o.id,o.name,
  count(*) filter(where uo.role='owner') owner_count,
  count(*) filter(where uo.role='admin') admin_count
from public.organizations o left join public.user_organizations uo on uo.organization_id=o.id
group by o.id,o.name
having count(*) filter(where uo.role='owner')=0 and count(*) filter(where uo.role='admin')=0;

select o.id,o.name,
 count(*) filter(where m.membership_stage='member' and m.status='active') active_members,
 count(*) filter(where m.membership_stage='visitor' and m.status='active') active_first_timers
from public.organizations o left join public.members m on m.org_id=o.id group by o.id,o.name;

select organization_id,
 count(*) filter(where role in ('owner','admin','finance')) management_users,
 count(*) filter(where role='owner') owners
from public.user_organizations group by organization_id;

