# Individual SMS permission

Implemented under the requested assumption that Twilio will support recorded verbal permission for informational church updates. This assumption does not enable the existing disabled provider or substitute for actual provider registration.

## Staff workflow

Open Communications → SMS → **SMS permission**. No campaign needs to be created first.

1. Choose a directory contact or enter a US phone number.
2. Select the message category and whether the person gave permission or opted out.
3. For informational permission, choose verbal conversation or written permission. Record the actual agreement date/time and what was explained and agreed to. Written permission also requires the location of its evidence.
4. Confirm the record is accurate and save. The server records the authenticated staff member and timestamp. The history remains available in the same scrollable screen.

Promotional/fundraising permission requires written evidence. New records do not release STOP or staff blocks. Category opt-outs affect that category; a global suppression continues to exclude the number from all SMS.

## Eligibility behavior

- Audience review consults individual permission history scoped to organization, phone, and category. An organization attestation no longer grants directory-wide eligibility.
- The latest actual choice wins. Recording an older conversation later does not override a newer opt-out. Opt-out wins equal choice timestamps.
- Informational permission does not grant promotional permission. Fundraising campaigns are checked as promotional even if their submitted criteria say informational.
- Readiness separates usable numbers, informational permissions, promotional permissions, suppressed numbers, and numbers without permission.
- Empty audience reviews show exclusion counts instead of throwing an unhelpful error. No sendable snapshot is created for an empty audience.
- Optional consent fields can be selected for form audiences. Arbitrary affirmative form answers filter respondents but no longer create evidence during audience review. Staff must review the original submission and record the appropriate written evidence in SMS permission. Automatic capture of versioned consent directly during public form submission remains future work.
- Every review reloads permissions and suppressions. Future delivery code must repeat that check at dispatch, including scheduled messages; this patch does not implement delivery.

No existing contact, attestation, or historical answer is automatically converted into a new permission grant.

## Database and rollout

Apply `supabase/migrations/20260912192649_sms_individual_permission_events.sql` before running the updated SMS screens against a database. The migration has been tested in an isolated PostgreSQL-compatible PGlite instance; it has **not been applied to the live Supabase project**.

The migration creates an append-only permission table with RLS enabled. Browser roles have no direct access. The authenticated, organization-authorized server endpoints have service-role select/insert access; service-role update/delete/truncate privileges are revoked. No new security-definer function is introduced. Historical evidence remains subject to organization deletion via its existing lifecycle, so this is not an indefinite retention guarantee.

It also fixes the foundation's doubled-backslash phone regex in settings, legacy consent, suppression, and recipient snapshot tables. The original expression was verified to reject a valid normalized `+1` number. The replacement accepts normalized US numbers and still rejects unnormalized input.

The local migration file is ready for the deployment's normal migration process. Do not blindly apply every other pending workspace migration along with it.

## Validation

Added 41 tests covering input validation, verbal/written category boundaries, authenticated actor attribution, tenant-scoped history, preserved suppressions, chronological revocations, empty/fundraising audiences, optional form fields, UI confirmation/reset/retry, SQL constraints, and database privileges. All 41 pass. The final full suite passes: **926 tests across 63 files**. TypeScript and lint checks pass for the changed application files. The existing provider-disabled tests continue to pass.

Public fellowship sites, automatic public-form consent capture, Twilio registration/verification, signed provider callbacks, and live delivery are not implemented by this patch.
