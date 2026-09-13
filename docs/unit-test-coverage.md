# Automated test review

## Verified result

The full suite passes **868 tests in 58 files**, up from 123 tests in 23 files. The account workflow expansion added 92 tests; the recurring-attendance patch adds a further 87 tests, including new route discovery and 31 real SQL tests in local PGlite. TypeScript (`npx tsc --noEmit`) passes. ESLint passes on the latest changed QR tests and production files. The earlier whole-suite lint run had nine warnings from simplified Next Image test doubles.

The attendance access/publishing fix adds 21 regression cases for live unresolved-count confirmation, cancellation, unavailable authentication services, expired-token retry, visible review errors, and compatibility before recurrence schema deployment. The real local browser verified QR loading and the unresolved publish confirmation; confirmation was cancelled, preserving the draft.

This is broad domain coverage, **not exhaustive behavioral coverage**. Last measured coverage (847-test run) across executable application, component, and library source is **35.31% lines, 32.57% statements, 21.87% branches, and 28.53% functions**. Unimported source is included in the denominator. Only type-only `types.ts` files are excluded. SQL migrations and Node-RED JSON are not instrumented by V8; recurrence SQL and scheduler function nodes have separate behavioral tests.

## Running the tests

```sh
npm ci
npm test
npm run test:coverage
npm run test:watch
npx tsc --noEmit
```

On PowerShell installations that block npm scripts, use `npm.cmd` and `npx.cmd`. Coverage output is generated locally at `coverage/index.html`, with machine-readable totals in `coverage/coverage-summary.json`. Coverage output is ignored by Git. The browser script under `tests/browser` is separate from the unit suite.

The suite requires no `rg` executable: source architecture checks use Node filesystem APIs. Worker concurrency is capped at four to limit transform/jsdom contention. API module imports have a separate 60-second setup timeout; handler assertions retain the default five-second timeout. After these portability fixes, the full coverage run again passed all 668 tests, and TypeScript passed.

Tests use fake provider keys, mocked SDK/database boundaries, and a default fetch implementation that rejects unexpected network calls. They do not require Stripe, Supabase, OpenAI, Resend, or SMS credentials. Query doubles verify filters and writes; they do not implement Postgres or validate actual row-level security policies.

## Coverage by area

| Area | Behavior exercised |
| --- | --- |
| All API routes | Automatically discovers 137 exported handlers; checks anonymous/invalid request responses, intended public/configuration exceptions, and absence of database writes or email sending |
| App pages | Automatically discovers 42 app pages; checks empty organization/API outage rendering and the legacy SMS redirect; eight additional public/auth pages render |
| Account setup | Free and paid onboarding validation, verified-account guards, idempotent setup, mailing-address messaging requirements, preferences |
| Authentication and permissions | Session persistence/cleanup, revoked sessions, organization scoping, role matrices for administration, finance, billing, forms, SMS, and reports |
| Billing | Plan catalog, Free/enterprise entitlements, quotas, Stripe configuration failures, subscription status and downgrade mapping, database failures |
| People | Service reuse/create/recovery, group membership/roles, department archive guards, directory pagination, birth dates, account preferences |
| Attendance | Check-in security, recurring schedules, date/DST previews, draft matching and capacity, pause/skip, deletion/publishing safeguards, database grants/RLS, public next-opening state, editor interactions, mobile browser scrolling and retry behavior |
| Forms | All 11 renderer field types, validation, preview/disabled submission, read-only field retention, public submission, Turnstile, analytics, field mappings, inbox filters and timezone boundaries |
| Email | Permissions, opt-outs, suppression, contact reuse/linking, eligibility, intake and rate limits, mailing-address checks, managed sending guards |
| SMS | Phone normalization, consent, segments, provider behavior, recipient parsing, settings initialization and attestation |
| Scheduling | Date/month validation, month creation/reuse, public/revoked tokens, branding, request serialization and API failures |
| Reports | All nine report definitions, inputs and roles, aggregation, privacy, CSV escaping, PDF failure cleanup, print URLs; actual member-giving summary/detailed/monthly calculations in token and administrative paths |
| Assistant | Existing policy/tools/plans/date tests plus budgets, concurrency, usage, conversation ownership and cleanup, signed handles, audit provenance and keyed member references |
| Shared UI/utilities | Form controls, service selector recovery, theme/color validation, markdown normalization, starters, unsaved state |
| Node-RED | Actual scheduler function-node code: secret configuration, header-only credentials, safe summaries, and error handling |

## Regressions fixed

- Color parsing accepted malformed hexadecimal strings and fractional RGB channels. Validation now rejects these inputs.
- Schedule date validation accepted impossible dates and invalid months. It now checks calendar validity.
- Submitting a form could erase read-only selections because disabled controls are omitted from browser FormData. Read-only answers are retained, and disabled submission is enforced inside the handler.
- Creating a service could leave the selector disabled after a failed network request. Errors are displayed, requests time out, and the busy state always clears.

Each fix has a regression test. Existing unrelated workspace changes were preserved.

## Remaining depth

### Latest workflow checks

The account setup page now has 97.75% line coverage, signup has 89.74%, the organization setup API has 100%, invitation acceptance has 100%, invitation creation has 89.85%, and the billing webhook has 79.41%. These numbers still do not imply complete branch coverage.

The new interaction tests exercise password confirmation, verification/resend, credential-free saved drafts, Free workspace creation, context application, paid confirmation recovery, optional address/logo, upload failures, invitation delivery fallback, seat limits, and retry behavior. Authenticated route tests check tenant and actor scoping, role changes/removal, expired invitations, recipient identity, duplicate webhooks, and processing failures.

They exposed and fixed two additional problems:

- Billing webhooks acknowledged success even if their audit/completion writes failed. Those failures now return an error and enter the retry path.
- The user role endpoint lacked a guard against admins changing an owner's role and did not validate role values before writing. Both guards are now enforced by the endpoint.

The Playwright onboarding walkthrough also passed against the running local app at mobile and desktop sizes, including scrolling, logo upload, checkout-error recovery, and verified invitation acceptance, with no page errors. Run it separately with `npm run test:browser:onboarding` while the app runs at `http://localhost:3000`; it uses installed Microsoft Edge. The script reads the Supabase URL from the environment or `.env.local` to match the app's session-storage key, mocks Supabase and application API requests, and blocks other external requests. It checks UI behavior, not real provider delivery or database persistence.

The route-wide tests exercise rejection boundaries, not every authenticated success path. Page-wide tests are render/outage checks; the dedicated onboarding interaction/browser tests add deeper coverage for that workflow. Many other edit, save, archive, bulk action, and retry interactions remain untested. Large page components account for much of the uncovered source.

The next useful additions are authenticated route success/error matrices and user interactions for income entry/publishing, attendance publishing, communications campaigns, and the remaining settings. Database migrations, RLS, concurrent writes, storage policies, real verification callbacks, live Stripe events, and actual email/SMS delivery require isolated integration environments. Passing the mocked unit and browser suites does not establish those properties.
