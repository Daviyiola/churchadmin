-- Safe rollback after check-ins exist: preserve audit/history, disable execution and public UI.
update public.attendance_checkin_codes set status='revoked',revoked_at=coalesce(revoked_at,now());
update public.attendance_checkin_windows set status='cancelled',closed_at=coalesce(closed_at,now()) where status in ('scheduled','open');
revoke all on function public.create_attendance_checkin_code(uuid,text,uuid,date),public.open_attendance_checkin_window(uuid,uuid,timestamptz,timestamptz),public.resolve_attendance_public_checkin(uuid,text,uuid,text,text,text) from authenticated;

