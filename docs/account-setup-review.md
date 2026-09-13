# Account setup review

Implemented in the working tree; not deployed.

## Owner journey

1. Choose Free or a paid plan. Enter an organization name and create a password with confirmation, or use an existing account.
2. Verify the account email. Signup returns to setup; verification can be resent. The browser draft preserves organization name, plan, interval, and request ID without storing passwords.
3. Free provisions without Stripe. Paid plans proceed through checkout before provisioning. Retrying a completed request opens its existing workspace; paid checkout cancellation preserves plan and interval. Status polling has a limit, network timeouts, and a retry action.
4. Review the organization name, upload an optional logo, and confirm the timezone. Supply a complete mailing address or explicitly defer it. Church email sending requires the address; essential account and invitation emails remain available.
5. Optionally invite a Member, Finance user, or Admin. The existing management-seat limits apply. Failed email delivery leaves a copyable invitation link. Invited users can verify their account and accept the invitation without another sign-out/sign-in cycle.
6. Open the dashboard. Owners with an unconfirmed timezone are offered setup again on sign-in and in an app banner. Workspace setup, organization settings, user management, and billing remain accessible in Settings.

Organization names are now editable through a server-authorized owner/admin endpoint. Logo uploads retain the existing tenant-scoped storage policies. Setup and settings use the app's existing rounded cards and controls. The mobile sidebar uses a horizontally scrolling navigation row, and user-management/global dialogs can scroll on short screens.

## Verification

- `npm.cmd test`: 123 tests passed, including setup authorization, address readiness, tenant logo validation, verified-email enforcement before provisioning, Free without Stripe, completed-request reuse, and checkout configuration errors.
- `npx.cmd tsc --noEmit`: passed.
- Production build passed. Network access was required to fetch the application's existing Google Fonts.
- `node tests/browser/onboarding.cjs` with a local server on port 3000: isolated browser checks with mocked Supabase/API responses. Covers password mismatch, verification guidance, no persisted password, mobile scrolling, desktop rendering, address deferral, logo upload, invitation email failure, checkout error recovery, and verified invitation acceptance. Screenshots are written to `tmp/`.
- Database transaction test against the configured project passed Free provisioning, owner membership, default settings, timezone saving, address deferral, and retrying the same intent. All test data was rolled back.
- Read-only database checks confirmed owner/admin logo permissions and settings permissions. Free includes two management seats, including the owner.

## Remaining deployment checks

The paid plan catalog has no monthly or annual Stripe price IDs configured. Complete Stripe keys, price mapping, webhook, and customer-portal setup, then exercise a real test-mode checkout, cancellation, webhook delivery, and renewal flow. No real charge was attempted.

Verify Supabase's deployed redirect allowlist includes the app's `/get-started` and `/invite/*` destinations (including query strings), and confirm signup verification email delivery with the configured mail provider. The browser verification checks mock delivery; they do not prove SMTP delivery or deployed redirect configuration. The implementation uses the existing client-side Supabase auth flow, as documented in [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).

No schema migration is required for these changes.
