create or replace function public.sync_member_birth_month_day()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.dob is not null then
    new.birth_month := extract(month from new.dob)::smallint;
    new.birth_day := extract(day from new.dob)::smallint;
  end if;
  return new;
end;
$$;

create trigger members_sync_birth_month_day
before insert or update of dob, birth_month, birth_day on public.members
for each row execute function public.sync_member_birth_month_day();

revoke all on function public.sync_member_birth_month_day()
  from public, anon, authenticated, service_role;

create or replace function public.carry_partial_birthday_on_member_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'merged'
     and old.status is distinct from 'merged'
     and new.merged_into_member_id is not null
     and new.dob is null
     and new.birth_month is not null then
    update public.members survivor
    set birth_month = new.birth_month,
        birth_day = new.birth_day
    where survivor.id = new.merged_into_member_id
      and survivor.org_id = new.org_id
      and survivor.dob is null
      and survivor.birth_month is null;
  end if;
  return new;
end;
$$;

create trigger members_carry_partial_birthday_on_merge
after update of status, merged_into_member_id on public.members
for each row execute function public.carry_partial_birthday_on_member_merge();

revoke all on function public.carry_partial_birthday_on_member_merge()
  from public, anon, authenticated, service_role;
