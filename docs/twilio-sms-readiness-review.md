# Twilio thread and SMS implementation review

Reviewed September 12, 2026. Scope: the supplied text of ticket **29186324**, current official Twilio documentation, and the local SMS implementation. This was not a live Twilio Console, deployed DNS, or database audit. The example image referenced in the email thread was not included in the supplied text, so its exact wording could not be inspected.

## Conclusion

Implementation follow-up: the individual verbal/written permission workflow and audience enforcement are now implemented locally. See [SMS verbal permission](sms-verbal-permission.md) for the current behavior, tests, migration requirement, and remaining work. The findings below describe the reviewed baseline.

The hosted-fellowship approach has support from Twilio, but the current implementation is a preparation and drafting foundation, not a production SMS integration. Sending is deliberately disabled. Before enabling it, fix recipient consent, build public fellowship pages, then implement registration and delivery.

Twilio's final clarification settles the checkbox question: SMS consent is optional, separate, and unchecked by default. Declining it must not prevent the underlying registration or form submission. Required Terms/Privacy acceptance must remain separate. This supersedes the earlier email saying all consent boxes were required. Current A2P documentation also explicitly illustrates separate required legal acceptance and optional SMS consent. [Twilio error 30925](https://www.twilio.com/docs/api/errors/30925)

## What the entire thread establishes

| Exchange | Meaning for ChurchAdmin |
| --- | --- |
| August 30 | Support accepts the proposed Sole Proprietor route for eligible informal fellowships without a tax ID, and a public fellowship-specific ChurchAdmins subdomain instead of an independently owned website. The page must identify the fellowship, provide contact details, and explain opt-in and messaging terms. |
| September 1 | Support accepts ministry names without formal DBA registration and shared templates producing tenant-specific legal pages. It gives representative reuse limits and discusses external campaigns and number migration. Its instruction requiring all SMS boxes is contradicted later. |
| September 4 | David explicitly proposes separate optional informational and promotional SMS choices, unchecked initially, with independent legal acceptance and a working main form when SMS is declined. |
| September 6 | Support confirms David's proposed optional-consent behavior. A solved ticket is not approval of a deployed opt-in flow, brand, or campaign. The reply offers a two-week follow-up window. |

Do not treat “as long as possible” as a defined retention period, or the migration discussion as confirmation that every Sole Proprietor registration can transfer through every provider.

## Implementation findings

### P0: Organization attestation currently substitutes for recipient consent

`lib/server/sms/audienceResolver.ts` admits selected directory members whenever an organization-wide attestation exists, recording `organization_attestation` as the consent basis. Membership, groups, departments, and a usable phone number can therefore produce eligible recipients without checking individual consent grants. `getSmsReadiness()` likewise labels valid, unsuppressed directory numbers eligible without a consent check.

Keep `lib/sms/attestation.ts` as a staff responsibility statement, but stop using it as the authorization to message every directory contact. Support verified evidence of existing consent, including an appropriate offline collection process; do not manufacture grants from directory membership.

Twilio requires consent for the identified sender and message subject. Its policy distinguishes informational consent from written consent for promotional messages, including promotion of a cause. A church-related message is not automatically informational. [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)

### P0: Optional form fields are excluded from SMS audience mapping

Both `getSmsAudienceOptions()` and `resolveSmsAudience()` require the mapped consent field to have `is_required = true`. `components/communications/SmsWorkspace.tsx` enforces the same filter and instructs users to choose a required consent field.

A required Yes/No field could permit No, so this is not proof that every existing form forces a positive answer. It does establish that the intended optional-checkbox implementation is excluded, and arbitrary mapped fields do not guarantee the agreed disclosures or separation.

Build a dedicated SMS consent block: independent optional informational and promotional checkboxes, both initially false, with separate legal acceptance. Preserve successful primary submission for neither, either, or both SMS choices. Merely removing the required-field filter is insufficient.

### P0: Consent has no usable informational/promotional boundary

`lib/sms/types.ts` describes message purposes such as announcements, events, and fundraising, but `resolveSmsAudience(orgId, raw, message)` receives no purpose/category. The foundation migration constrains consent scope to `church_communications`.

Introduce explicit program/category grants scoped to the fellowship and phone number. Audience preview and final dispatch must enforce the applicable grant and current revocations. Mixed content must not bypass promotional consent through an informational label. Show separate counts for usable numbers, consented recipients, and suppressed recipients.

### P0: Evidence is generated during audience review, using today's label

The resolver inserts positive form-consent evidence when an audience is reviewed. It reads the current field label rather than the submission's historical `form_snapshot`. Changing field wording or the affirmative-answer mapping can therefore misrepresent what someone agreed to. Existing consent records are queried for deduplication, not their current revoked/granted state when deciding eligibility.

Capture consent when the form is submitted, with immutable events for choices and subsequent revocations. Store sender/program/category, normalized phone, timestamp, source, exact disclosure/version, legal URLs/versions, and form revision. Use existing form snapshots when reviewing historical evidence; never reinterpret an unrelated old answer as new consent. Do not infer that an unchecked box on an unrelated later form automatically revokes a prior grant; make preference changes explicit.

Set an evidence retention and deletion policy, including organization closure/export behavior. Twilio's policy calls for proof through at least withdrawal and any longer applicable legal period; it does not supply a universal number of years. The thread's answer does not resolve that. [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)

### P1: Setup is a useful draft, not registration

`components/communications/SmsSetupWizard.tsx` collects readiness, organization details, representative information, messaging intent, consent methods, sample messages, and number preferences. It does not complete identity verification or register a brand/campaign. `ready_for_provider` must remain distinct from provider approval.

Add eligible registration branches, required identity details, address and verification handling, public evidence URLs, category-aligned samples, provider identifiers, approval/rejection states, and resumable remediation. Avoid storing sensitive verification data unnecessarily.

The ISV guide requires the customer's identity, an eligible non-CPaaS mobile number for verification, and the profile → trust bundle → brand/OTP → messaging service/campaign workflow. It uses `SOLE_PROPRIETOR` as the campaign use case. Its brand-name guidance is stricter than the ticket's informal-ministry-name answer, so obtain exact field mapping before automating that branch. [Sole Proprietor ISV API guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-sole-prop-new)

### P1: Public fellowship pages need implementation

The repository has public forms and platform legal pages, but this review found no tenant-host resolution or complete fellowship-specific SMS website flow. `components/legal/PrivacyContent.tsx` already contains a useful mobile-data non-sharing provision; this does not replace tenant/program-specific disclosures.

Use shared templates to produce public pages on each fellowship's own subdomain: identity/contact page, opt-in form, SMS terms, and privacy policy. Add unique hostname routing and tenant isolation. Keep legal pages accessible without login on that business hostname. Twilio's business-information guide describes same-domain terms and the required public evidence and sample messages. [Required business information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)

### P1: Twilio delivery is not connected

`lib/server/sms/provider.ts` has only a local mock; production provider access and sends throw. Drafting, phone normalization, deduplication, segment estimates, suppression tables, and recipient snapshots are useful foundations.

Implement the provider adapter, tenant resource mapping, registration/status callbacks, delivery tracking, retries and duplicate prevention, usage limits, and billing reconciliation. Check current consent, suppression, registration, and account readiness immediately before each dispatch, including scheduled campaigns. Calculate estimates from the final personalized text, including required sender/opt-out text.

Handle STOP/START/HELP through a deliberate Messaging Service configuration and sync resulting events locally. Advanced Opt-Out callbacks identify handled keywords with `OptOutType`; avoid sending duplicate automated responses. START must not silently grant unrelated promotional categories. [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)

Validate webhook signatures against the actual externally visible request URL and payload, then enforce tenant association and replay/idempotency protections. [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)

## Recommended owner and recipient workflows

1. Owner prepares a fellowship profile and public pages, choosing the correct registration branch. Logo remains optional. Save progress and clearly identify missing requirements.
2. Recipient completes the normal form, independently choosing informational SMS, promotional SMS, both, or neither. A phone number alone is not an opt-in. The confirmation accurately reflects their choices.
3. Owner reviews generated disclosures and samples, completes verification, and submits registration. Show pending, approved, or action-required states with a resumable next step.
4. Owner composes a message and chooses its category. Preview explains exclusions: no relevant consent, opted out, invalid number, or duplicate.
5. Sending becomes available only when provider prerequisites and recipient eligibility pass. Scheduled messages are checked again at dispatch. Preference changes and STOP feed the same authoritative consent/suppression state.

Use the existing application UI, ordinary scrollable layouts, and a persistent setup checklist. Registration delays must not trap the owner on a blocking screen.

## Work order

### Follow-up: verbal consent as the normal church workflow

David clarified that most churches would collect consent verbally. Design for that operational reality, but obtain a specific ISV policy clarification before treating staff-recorded verbal consent as sufficient to enable sends. Twilio's campaign guidance recognizes verbal opt-in paths, while its Messaging Policy's “Consent from Your End Users or Customers” provision requires prior express written consent from downstream users of a software service. The earlier review did not call out this additional provision. The general informational-message rule alone therefore does not settle ChurchAdmins' eligibility to rely only on verbal consent. [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy), [Campaign opt-in guidance](https://www.twilio.com/docs/api/errors/30909)

Ask Twilio: “Our church customers usually obtain verbal permission for recurring internal informational texts. As an ISV, may we support that with a staff record of the recipient, date, collector, and disclosed script, despite the downstream-user written-consent provision? What exact evidence is required?” A staff record is a proposed evidence mechanism, not a confirmed Twilio-approved substitute for recipient written consent. If written confirmation is required, propose recipient-initiated keyword enrollment with the full disclosures as a low-friction alternative to a web form; submit that exact flow for review. Do not send unsolicited enrollment-request texts to the directory.

**Phase 1 — consent and reviewable public evidence:** dedicated consent controls, versioned evidence capture, per-category eligibility, revocations, tenant pages, legal templates, and regression tests. Keep sending disabled. Submit the resulting real URLs/screenshots to Twilio for pre-review.

**Phase 2 — registration and provider connection:** resolve naming/use-case questions, implement the identity branches, actual verification and provider status lifecycle, then signed callbacks and delivery infrastructure.

**Phase 3 — controlled pilot:** one approved fellowship and number, consenting test recipients, real opt-out/preference and delivery tests, cost reconciliation, and a broader rollout only after these pass. An initially narrow informational program could reduce product scope, but its actual content still needs correct classification.

## Verification performed and missing coverage

Ran:

```text
npm.cmd test -- --run tests/sms-consent.test.ts tests/sms-provider.test.ts tests/sms-phone.test.ts tests/sms-segments.test.ts
```

Result: **13 tests passed across 4 files**. Output: `tmp/twilio-review-tests.txt`. These cover utility behavior and the disabled provider, not production registration or end-to-end consent compliance. No messages were sent and no application code or live provider settings were changed for this review.

Add behavior tests for: submission with neither/either/both SMS choices; legal acceptance independent of SMS; unchecked initial controls; immutable disclosure snapshots; no grants from membership alone; informational versus promotional eligibility; revoked grants; cross-organization isolation; STOP after audience snapshot and before dispatch; signed/invalid/replayed callbacks; safe retries; registration gating; and final rendered segment estimates.

## Suggested follow-up to Twilio — draft only, not sent

Thank you for confirming that SMS consent is optional, separate, and unchecked by default. We will implement that behavior and provide fellowship-specific public opt-in and legal URLs for pre-review.

Before completing registration, please clarify:

1. For an informal fellowship with no EIN or registered DBA, which exact legal-name and brand-name fields should contain the individual's name versus the ministry name? Your reply permits the ministry name, while the Sole Proprietor API guide describes personal-name/DBA rules.
2. The API guide uses `SOLE_PROPRIETOR`. Can our proposed informational and promotional program, including the proposed fundraising content, operate under that use case with separate consent, or does any of that content require another eligible registration route?
3. Beyond the TCR identity reuse limits you described, what account-level onboarding limits or review requirements apply to ChurchAdmins as an ISV? We will use each actual customer's representative rather than reuse our own identity.
4. Is there a specified Twilio evidence retention period beyond the Messaging Policy, and what evidence must remain available after opt-out or customer closure?
5. Which Sole Proprietor brand/campaign records can transfer in or out, what approvals and identifiers are needed, and what is the recommended sequence with number porting? Is ERC access available for our intended cases?

The thread lists email/address reuse limits of 10 brands and mobile verification for 3 brands across TCR/providers; these are not a total ISV customer allowance. The documented ERC API requires coordinated access. Treat number porting and registration migration as separate workstreams until the applicable process is confirmed. [Externally Registered Campaigns API](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/externally-registered-campaigns-api)
