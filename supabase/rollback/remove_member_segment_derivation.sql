-- Removes future-write enforcement while preserving the corrected segment
-- values written by the forward migration.

drop trigger if exists members_sync_segment on public.members;

alter table public.members
  drop constraint if exists members_segment_matches_demographics;

drop function if exists public.sync_member_segment();

