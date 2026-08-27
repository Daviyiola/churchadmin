# RumbleUp Partnership Meeting Brief

## Objective

Determine whether RumbleUp can operate as the underlying SMS delivery and compliance provider for Church Admin while Church Admin remains the primary product experience for each church.

The meeting should establish three things:

1. Whether the proposed multi-tenant architecture is supported.
2. Whether the per-church economics are viable.
3. Whether small churches and unincorporated fellowships can be onboarded compliantly.

## Suggested Introduction

> Church Admin is a multi-tenant church-management SaaS. It already manages members, visitors, groups, departments, attendance, finances, forms, schedules, follow-ups, reports and email communications.
>
> We are evaluating RumbleUp as the messaging infrastructure underneath Church Admin's SMS interface. Churches would compose messages, choose recipients, view replies and manage usage in Church Admin. RumbleUp would handle delivery, phone numbers, carrier registration, opt-outs and messaging compliance.
>
> I would like to confirm whether your master-account, subaccount and API model supports that architecture and understand the associated per-church costs.

## Essential Questions

### 1. Is Church Admin's intended architecture supported?

> Are you comfortable operating as the messaging infrastructure beneath another SaaS product, where churches ordinarily remain inside Church Admin and do not use the RumbleUp portal?

Follow-ups:

- Can Church Admin maintain one master account and create an isolated subaccount for each church through the API?
- Are contacts, campaigns, phone numbers, replies, opt-outs, reporting and billing isolated between subaccounts?
- Does creating and managing subaccounts require a special agency, ISV, reseller or enterprise agreement?
- Can one master credential operate across subaccounts, or does each church require separate API credentials?
- Can subaccount credentials be restricted, rotated or revoked?

### 2. What does each church actually cost?

> Does every subaccount incur the public $19 monthly subscription, or are subaccounts priced differently under a master or ISV agreement?

Follow-ups:

- Is there a separate fee for the master account?
- Are unlimited subaccounts genuinely included?
- Are there minimum monthly message volumes or spending commitments?
- Are API access, Fast Mode, webhooks, white-labeling, roll-up billing or dedicated numbers priced separately?
- Are the published SMS prices inclusive of carrier fees, or are carrier surcharges added?
- What one-time and recurring TCR charges should we expect per church?
- Are volume discounts calculated across the master account or separately for each church?

### 3. Can Church Admin charge churches for SMS?

> Does RumbleUp permit Church Admin to resell messaging credits or charge churches an SMS add-on through our own billing system?

Follow-ups:

- Can all subaccounts draw from one master balance?
- Can Church Admin assign a spending or message limit to each church?
- Can balances, segment usage, fees and spending be retrieved per subaccount through the API?
- Can a subaccount be paused automatically when it reaches its Church Admin allowance?
- Are there restrictions on adding a margin to message credits?
- Who is financially responsible for overages, chargebacks or carrier penalties?

### 4. How would church onboarding and 10DLC registration work?

> Can Church Admin collect onboarding information in its own wizard, create the RumbleUp subaccount programmatically and send the church to RumbleUp only for legally required verification or attestation?

Follow-ups:

- Can TCR brand and campaign registration be submitted through an API?
- If registration is not API-driven, do you provide a secure hosted onboarding link for a particular subaccount?
- Can that hosted step return the user to Church Admin afterward?
- Can Church Admin retrieve registration status, rejection reasons and required corrections through APIs or webhooks?
- Must a church representative personally accept RumbleUp's terms?
- Can we display the terms and record acceptance in Church Admin, or must acceptance occur on a RumbleUp page?
- Does your compliance team review the application before it reaches carriers?
- What is the realistic approval timeline for a typical church?

### 5. Can small or unincorporated fellowships qualify?

> Some Church Admin organizations are small fellowships without an EIN, formal incorporation, a 501(c)(3) determination letter or a public website. Can they still qualify for compliant messaging?

Follow-ups:

- Which account and TCR classification should such an organization use?
- What alternative documentation is acceptable?
- Can a responsible individual register on behalf of an unincorporated fellowship?
- Is a social-media page, Church Admin-hosted public page or hosted opt-in form sufficient as an online presence?
- Would these organizations receive lower throughput or different restrictions?
- What should we avoid doing so these organizations are not incorrectly classified?

### 6. Does the Messaging API support Church Admin's workflows?

> Can Church Admin receive Fast Mode access so we can keep the authoritative contacts in our database and send directly to approved phone numbers?

Follow-ups:

- Does Fast Mode support announcements, reminders, visitor follow-ups, schedule notifications and conversational replies?
- Are there minimum volumes, approvals or additional fees for Fast Mode?
- Can messages be scheduled through the API?
- Can one project send a personalized message to many recipients without a manual send action for every person?
- Can each church select and retain its own local phone number?
- Can delivery failures, carrier error codes and segment counts be retrieved reliably?
- Are MMS, Unicode and long-message segment calculations exposed before sending?
- What throughput and concurrency limits apply per church and to the master account?

### 7. How are replies, consent and opt-outs handled?

> Can incoming replies, delivery events, failures and opt-outs be delivered to Church Admin in real time through signed webhooks?

Follow-ups:

- Does RumbleUp automatically recognize and suppress STOP and equivalent opt-out language?
- Will RumbleUp block a suppressed number even if Church Admin accidentally submits it again?
- Can Church Admin query or export each church's suppression list?
- Can an opt-out be shared across multiple campaigns or numbers belonging to the same church?
- How are HELP requests handled?
- Who stores the authoritative proof of consent and opt-out history?
- What consent evidence must each church maintain?

### 8. Who controls the phone numbers and data?

> Does each church receive a dedicated number, and can that number be ported if the church later leaves Church Admin or RumbleUp?

Follow-ups:

- Can an existing church number be ported into RumbleUp?
- Who is considered the owner or authorized user of a provisioned number?
- What happens to the number if a subaccount is suspended or closed?
- How long are contacts, messages, replies and delivery records retained?
- Can Church Admin export all church messaging data?
- Do you provide a data-processing agreement and current security documentation?
- Is customer data used for advertising, model training or purposes unrelated to message delivery?

### 9. What does white-labeling actually include?

> Can churches operate entirely within Church Admin after registration, and what RumbleUp branding or portal access is contractually required?

Follow-ups:

- Is white-labeling included or separately priced?
- Can Church Admin use its own domain and branding for any hosted onboarding pages?
- Are there recurring actions that a church must perform in the RumbleUp portal?
- Can support requests be routed through Church Admin, or must churches contact RumbleUp directly?
- Will RumbleUp market other services directly to Church Admin's churches?

### 10. What happens when something goes wrong?

> How are rejected registrations, suspended campaigns, carrier filtering, unusual traffic and compliance complaints handled in a master/subaccount environment?

Follow-ups:

- Can one problematic church affect the reputation or sending ability of other Church Admin organizations?
- Can RumbleUp suspend one subaccount without suspending the master account?
- What alerts and webhook events are provided for compliance or delivery problems?
- What support response time is available for production incidents?
- Is seven-day support included for API and compliance problems, or only portal usage?

## Product-Fit Question

Ask this directly before the meeting ends:

> Since Church Admin already owns the customer relationship, contacts, groups, forms, campaign interface and billing experience, can RumbleUp function primarily as our delivery and compliance layer without requiring us to duplicate our entire product inside your CRM?

The answer should clarify whether RumbleUp sees Church Admin as an integration partner or merely as another customer that must use the RumbleUp application.

## Questions to Prioritize if Time Is Short

If only a few minutes remain, get clear answers to these six questions:

1. Can Church Admin create and manage isolated church subaccounts through one master API account?
2. Does every subaccount cost $19 per month, and what other per-church fees apply?
3. May Church Admin resell message credits and use consolidated billing?
4. Can registration be completed through an API or hosted handoff, and can unincorporated fellowships qualify?
5. Can Church Admin receive Fast Mode, webhooks and dedicated numbers for every subaccount?
6. Can churches remain entirely inside Church Admin after onboarding?

## Answers That Need Clarification

Do not leave these statements unexamined:

- **"It depends."** Ask what it depends on and request the applicable thresholds.
- **"We support subaccounts."** Ask whether each one has a subscription fee and separate registration.
- **"We support white-labeling."** Ask what the church still sees and how it is priced.
- **"Our team handles compliance."** Ask which responsibilities and liabilities remain with Church Admin and each church.
- **"The API supports it."** Ask for the exact endpoint, access level and whether special enablement is required.
- **"We can discuss custom pricing later."** Ask for an illustrative price at 10, 50 and 100 low-volume churches.

## Commercial Scenarios to Request

Ask them to quote estimated monthly costs for:

- 10 churches sending 500 SMS segments each per month.
- 10 churches sending 2,000 SMS segments each per month.
- 50 churches sending 1,000 SMS segments each per month.
- One church sending no messages during a month but retaining its number and registration.

Each example should show:

- Master-account fee.
- Subaccount fees.
- Phone-number fees.
- TCR fees.
- SMS and carrier fees.
- API, Fast Mode, webhook and white-label fees.
- Minimum commitments.

## Before Ending the Meeting

Ask for:

- Written pricing for the proposed architecture.
- Confirmation that credit resale is permitted.
- A sample ISV, agency or master-account agreement.
- API access requirements and Fast Mode enablement requirements.
- TCR onboarding documentation for churches and unincorporated organizations.
- Webhook documentation, security documentation and a DPA.
- A technical contact for a proof of concept.
- A follow-up email documenting any answers given verbally.

## Internal Decision Standard

RumbleUp is a strong fit only if:

- Church Admin can create and isolate church subaccounts programmatically.
- The per-subaccount fixed cost works with Church Admin's pricing.
- Church Admin may bill churches and resell credits.
- Small fellowships have a legitimate registration path.
- Churches can remain primarily inside Church Admin.
- Fast Mode and required webhooks are available.
- One church's compliance problem does not endanger every tenant.

If these conditions are not met, RumbleUp may be useful as a bring-your-own-provider integration, but it would not be suitable as Church Admin's invisible shared SMS infrastructure.
