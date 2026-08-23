update public.members
set birth_month = extract(month from dob)::smallint,
    birth_day = extract(day from dob)::smallint
where dob is not null;

alter table public.members
  add constraint members_birth_month_day_pair_check check (
    (birth_month is null and birth_day is null)
    or (
      birth_month between 1 and 12
      and birth_day between 1 and
        (array[31,29,31,30,31,30,31,31,30,31,30,31])[birth_month::integer]
    )
  ),
  add constraint members_full_birth_date_matches_month_day_check check (
    dob is null
    or (
      birth_month = extract(month from dob)::smallint
      and birth_day = extract(day from dob)::smallint
    )
  );
