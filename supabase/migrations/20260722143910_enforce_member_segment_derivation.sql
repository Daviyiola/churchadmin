-- Keep members.segment as a database-derived value of gender + age_group.
-- This repairs legacy rows and prevents clients, imports, or RPCs from
-- leaving a null or contradictory segment behind.

create or replace function public.sync_member_segment()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.gender is null or new.age_group is null then
    new.segment := null;
  else
    new.segment := public.compute_segment(new.gender, new.age_group);
  end if;

  return new;
end;
$function$;

drop trigger if exists members_sync_segment on public.members;
create trigger members_sync_segment
before insert or update of gender, age_group, segment
on public.members
for each row
execute function public.sync_member_segment();

alter table public.members
  drop constraint if exists members_segment_matches_demographics;

alter table public.members
  add constraint members_segment_matches_demographics
  check (
    (
      (gender is null or age_group is null)
      and segment is null
    )
    or
    (
      gender is not null
      and age_group is not null
      and segment = public.compute_segment(gender, age_group)
    )
  ) not valid;

-- Do not alter updated_at/updated_by: this is a system consistency repair,
-- not a user-authored member profile edit.
update public.members
set segment = case
  when gender is null or age_group is null then null
  else public.compute_segment(gender, age_group)
end
where segment is distinct from case
  when gender is null or age_group is null then null
  else public.compute_segment(gender, age_group)
end;

alter table public.members
  validate constraint members_segment_matches_demographics;

