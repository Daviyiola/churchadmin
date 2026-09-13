# Recurring attendance QR check-in

Each reusable QR can now have a weekly schedule: selected weekdays, every 1–12 weeks, a start date, optional end date, service start time, and opening/closing offsets. Intervals are anchored to Monday of the starting week. The editor previews upcoming windows in the confirmed organization timezone.

The schedule worker runs every minute. It prepares a window 15 minutes before check-in opens, reusing a matching attendance draft or creating an empty draft. Future previews do not create drafts. Windows open/close according to their timestamps; attendance remains a draft until staff publishes it.

## Matching and overrides

- Matching uses organization, service category, local service date, and service time. Multiple entrances with the same occurrence share a draft; different service times get separate drafts.
- A single unassigned draft can be adopted. Multiple possible drafts, a published match, an archived service, a changed timezone, or the ten-draft cap is shown as **Needs attention**. No replacement draft is silently created.
- For an ambiguous match, staff can explicitly choose the correct draft through **One-time window**. That selection assigns the occurrence and clears the warning.
- **Skip** suppresses the selected date; **Pause** closes the current automatic window and stops new automatic windows. **Resume** applies to future occurrences and does not reopen the closed one.
- Manually closing, cancelling, or publishing an occurrence leaves a persistent marker. The worker cannot reopen it. Intentional staff-created one-time windows remain available.
- Deleting a draft with a linked recurring window records a skip before the window is removed. Automation does not recreate that deleted occurrence.
- Changes to a schedule require closing an already assigned live window first. Skips and completed occurrence markers remain in place after editing.
- Repeated fall-back local times use the later occurrence, matching PostgreSQL. Nonexistent spring-forward times are skipped and flagged when due. Scheduled local service times otherwise remain constant through DST.

## Interface changes

QR dialogs have bounded heights and scrollable content. Recurrence is available even when there are no drafts. The one-time picker prefers the QR's default service and today's matching draft; otherwise it asks staff to choose.

The manager shows upcoming dates and errors, refreshes while open, and can refresh schedules explicitly. Draft updates do not dismiss an open QR editor. Requests time out and release their busy state on failure. The public page shows the next opening, refreshes every 15 seconds while visible, and supports retrying failed check-ins. Times are rendered in the organization timezone.

## Database rollout

Apply `supabase/migrations/20260906115151_attendance_recurring_qr.sql` **before deploying the application changes**. The migration depends on the existing multiple-QR attendance migrations. The patch does not apply itself to the linked database.

The migration adds schedule/skip tables, occurrence markers, a per-service-time unique index, a draft-capacity trigger, authenticated schedule RPCs, and the `attendance-recurring-checkin` cron job. New schedule tables use RLS with staff-only reads. Direct authenticated writes are revoked. Automation lives in a private schema; public mutation wrappers call functions that verify `auth.uid()` and organization access. The background worker is unavailable to anonymous/authenticated callers.

Existing QR URLs and manual windows are preserved. No recurring schedules are enabled automatically for existing QR codes. The ten-draft restriction already shown in the attendance UI is now enforced for database inserts and draft restoration as well.

After applying, verify:

```sql
select jobname, schedule, active from cron.job
where jobname = 'attendance-recurring-checkin';

select command, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'attendance-recurring-checkin')
order by start_time desc limit 5;
```

For an operational stop, pause schedules through the UI, or disable the cron job with an administrator account. Preserve tables, occurrence markers, and drafts. Reverting the application code alone does not stop the database worker. Do not remove occurrence history after check-ins have been collected.

## Verification

Final verification: **847 tests in 53 files passed**, including 31 local SQL recurrence tests. TypeScript and lint for the changed QR code/tests passed. The mobile/desktop browser walkthrough passed with no page errors. Overall instrumented line coverage is 35.31%; SQL behavior is tested separately and is not included in V8's coverage percentage.

- `npm test` includes recurrence validation/preview, authenticated API, editor interactions, and SQL tests.
- `tests/attendance-recurrence-sql.test.ts` executes the actual migration in local PGlite, with a minimal prerequisite schema modeled on the existing attendance schema and a cron registration stub. It tests real PostgreSQL functions, constraints, grants/RLS, duplicate prevention, draft matching, capacity, publishing, pause/skip, manual overrides, and DST. It does not run a real pg_cron daemon or prove concurrent throughput in a hosted database.
- `npm run test:browser:attendance` runs the mobile/desktop browser walkthrough using Microsoft Edge and a local app at `http://localhost:3000`. It mocks all provider/API traffic, checks scrolling and retry behavior, and checks automatic public-page refresh. Match the app's Supabase URL through the environment or `.env.local` so the mock session uses the correct storage key.
- Hosted schema metadata was inspected read-only for compatibility; hosted data and schedules were not modified during development.

Monthly patterns, editing a single occurrence's time, and extension shortcuts are outside this first release. One-time windows remain the manual override.

## Compatibility before rollout

If the recurrence tables/columns are not deployed, existing QR codes and manual windows remain available. The manager disables recurrence and explains that repeating check-in is not available yet. Other database errors are still surfaced. Public codes without a manual window display the closed state until recurrence is deployed.

For local development, run Next.js with network access to Supabase. A restricted server process can fail `auth.getUser` even while browser database queries work. Attendance routes now return a service-unavailable error for authentication network failures rather than incorrectly reporting Unauthorized. Publishing reads the current unresolved count before confirmation, independently of the review panel.
