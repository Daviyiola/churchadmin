drop function if exists public.create_first_timer_visitor(
  uuid, uuid, text, text, text, text, text, text, text, text, integer,
  date, text, text[], text, date
);

-- Reapply 20260822032903_intake_phase_zero_staff_visitor_rpc.sql when rolling
-- back this migration together with the matching application route.
