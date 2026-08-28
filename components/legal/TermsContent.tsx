import LegalLayout from "./LegalLayout";
import { Divider, Li, P, Section, Toc, Ul } from "./LegalBlocks";

const TOC = [
  { id: "acceptance", label: "1. Acceptance and Authority" },
  { id: "service", label: "2. The Church Admin Service" },
  { id: "accounts", label: "3. Accounts, Organizations, and Roles" },
  { id: "customer-data", label: "4. Organization Data and Responsibilities" },
  { id: "plans", label: "5. Plans, Limits, and Changes" },
  { id: "billing", label: "6. Billing, Renewal, and Refunds" },
  { id: "communications", label: "7. Email and Other Communications" },
  { id: "sms", label: "8. SMS Services and Messaging Credits" },
  { id: "forms", label: "9. Forms, Links, and Submissions" },
  { id: "ai", label: "10. Nikky AI Assistant" },
  { id: "minors", label: "11. Minors and Sensitive Information" },
  { id: "acceptable-use", label: "12. Acceptable Use" },
  { id: "third-parties", label: "13. Third-Party Services" },
  { id: "ownership", label: "14. Intellectual Property" },
  { id: "availability", label: "15. Availability and Changes" },
  { id: "termination", label: "16. Suspension, Cancellation, and Deletion" },
  { id: "disclaimers", label: "17. Disclaimers" },
  { id: "liability", label: "18. Limitation of Liability" },
  { id: "indemnity", label: "19. Indemnification" },
  { id: "disputes", label: "20. Disputes and Governing Law" },
  { id: "general", label: "21. General Terms" },
  { id: "changes", label: "22. Changes to These Terms" },
  { id: "contact", label: "23. Contact" },
];

export default function TermsContent() {
  return (
    <LegalLayout
      title="Terms of Service"
      subtitle="Church Admin"
      meta={
        <div className="space-y-1">
          <div>
            <span className="font-medium">Effective Date:</span> August 27, 2026
          </div>
          <div>
            <span className="font-medium">Provider:</span> Davola Technologies LLC
          </div>
        </div>
      }
    >
      <Toc items={TOC} />

      <Section id="acceptance" title="1. Acceptance and Authority">
        <P>
          These Terms of Service (“Terms”) govern access to and use of Church
          Admin, including its websites, applications, and related services
          (collectively, the “Service”), provided by Davola Technologies LLC
          (“Davola,” “we,” “us,” or “our”).
        </P>
        <P>
          By creating an account, accepting an invitation, purchasing a plan,
          or using the Service, you agree to these Terms and our Privacy Policy.
          If you use the Service for a church, ministry, fellowship, nonprofit,
          or other organization (“Organization”), you represent that you have
          authority to bind that Organization. If you do not agree, do not use
          the Service.
        </P>
        <P>
          You must be at least 18 years old and legally capable of entering a
          binding agreement to create an Organization or purchase services.
        </P>
      </Section>

      <Divider />

      <Section id="service" title="2. The Church Admin Service">
        <P>
          Church Admin provides tools for church and ministry administration.
          Depending on plan, configuration, and availability, features may
          include:
        </P>
        <Ul>
          <Li>Member, first-timer, visitor, group, and department records</Li>
          <Li>Attendance, schedules, assignments, and follow-ups</Li>
          <Li>Income, expenses, giving records, reports, and exports</Li>
          <Li>Forms, public links, submissions, custom fields, and response processing</Li>
          <Li>Email, SMS preparation, recipient selection, and communication history</Li>
          <Li>Role-based administration, audit history, and organization settings</Li>
          <Li>Nikky, a read-only AI-assisted interface for approved records and reports</Li>
        </Ul>
        <P>
          Church Admin is administrative software. It is not a bank, payment
          processor, accounting firm, tax preparer, law firm, pastoral-care
          provider, emergency service, or substitute for professional advice.
          Organizations remain responsible for reviewing records, reports,
          communications, and decisions made using the Service.
        </P>
      </Section>

      <Divider />

      <Section id="accounts" title="3. Accounts, Organizations, and Roles">
        <P>You are responsible for:</P>
        <Ul>
          <Li>Providing accurate account and Organization information</Li>
          <Li>Protecting credentials and promptly reporting suspected unauthorized access</Li>
          <Li>Assigning the least-privileged appropriate owner, admin, finance, or member role</Li>
          <Li>Removing access when a person no longer requires it</Li>
          <Li>All activity performed through accounts you authorize</Li>
        </Ul>
        <P>
          Owners control billing and other high-impact Organization settings.
          Role descriptions in the Service are summaries, and actual access may
          depend on current configuration, plan, and security rules. We may
          require email verification, reauthentication, or additional checks.
        </P>
      </Section>

      <Divider />

      <Section id="customer-data" title="4. Organization Data and Responsibilities">
        <P>
          As between Davola and the Organization, the Organization retains its
          rights in information, files, messages, form responses, reports, and
          other content submitted to the Service (“Organization Data”). The
          Organization grants Davola and its service providers a limited right
          to host, process, transmit, reproduce, and display Organization Data
          as needed to provide, secure, support, and improve the Service.
        </P>
        <P>The Organization is responsible for:</P>
        <Ul>
          <Li>Having a lawful basis and all required notices and consents for Organization Data</Li>
          <Li>Keeping records accurate, relevant, and no more extensive than needed</Li>
          <Li>Responding to requests from members, visitors, donors, employees, volunteers, and form respondents</Li>
          <Li>Reviewing imports, merges, field mappings, reports, and changes before relying on them</Li>
          <Li>Exporting records it is required or wishes to retain</Li>
        </Ul>
        <P>
          Member merging and certain permanent-deletion actions are
          intentionally irreversible. Audit records may preserve limited
          snapshots or event metadata for security, accountability, and legal
          purposes even after an operational record changes.
        </P>
      </Section>

      <Divider />

      <Section id="plans" title="5. Plans, Limits, and Changes">
        <P>
          Free, Basic, Growth, Pro, Founder, Enterprise, and other plans may
          have different limits for members, first-timers, management seats,
          forms, emails, Nikky usage, and other features. Current public limits
          and prices are shown on our pricing and billing pages or in an
          applicable order form.
        </P>
        <Ul>
          <Li>Limits are enforced automatically and may apply across all authorized users of an Organization.</Li>
          <Li>Existing records are not automatically deleted merely because a plan is downgraded or a limit is exceeded.</Li>
          <Li>Actions that increase an over-limit count may be blocked until usage is reduced or the plan is upgraded.</Li>
          <Li>Features described as beta, preview, pending, or unavailable may not be included in a plan.</Li>
        </Ul>
        <P>
          We may change plan names, features, limits, or pricing prospectively
          with reasonable notice when required. Enterprise terms may be
          modified by a signed order form or other written agreement.
        </P>
      </Section>

      <Divider />

      <Section id="billing" title="6. Billing, Renewal, and Refunds">
        <P>
          Paid subscriptions are billed in advance through our payment
          processor on a recurring monthly or annual basis. Unless canceled,
          subscriptions renew automatically at the then-applicable price.
          Upgrades may take effect after successful payment and may be prorated.
          Downgrades, interval changes, and cancellations generally take effect
          at the end of the current paid term.
        </P>
        <P className="font-medium">Initial Purchase Refund</P>
        <P>
          A first-time paid subscription may be eligible for a full refund if
          requested within seven calendar days of the initial purchase.
          Renewals, messaging credits, provider fees, taxes, and charges after
          that window are non-refundable except where required by law or
          expressly stated at purchase.
        </P>
        <P>
          Failed payments may result in a grace period, suspension of paid
          functionality, or fallback to Free limits without deletion of
          Organization Data. Applicable taxes may be calculated from billing
          information and added where required.
        </P>
        <P>
          Complimentary Founder access does not automatically become a paid
          subscription. An owner must affirmatively authorize paid renewal.
        </P>
      </Section>

      <Divider />

      <Section id="communications" title="7. Email and Other Communications">
        <P>
          The Organization is the sender of communications it initiates through
          Church Admin and is responsible for message content, recipients,
          timing, and legal compliance. This includes obtaining any required
          permission, using accurate sender information, honoring unsubscribe
          and opt-out requests, and complying with CAN-SPAM and other applicable
          laws, provider rules, and industry standards.
        </P>
        <P>
          The Organization may select recipients from member, first-timer,
          visitor, group, department, form-response, or manually supplied
          information where supported. Recipient tools reduce mistakes but do
          not establish that a communication is lawful or appropriate.
        </P>
        <P>
          Delivery, opening, filtering, and receipt are not guaranteed.
          Messages may be delayed, rejected, filtered, suppressed, or blocked
          by recipients, providers, carriers, or security systems.
        </P>
        <P>
          Church Admin provides technical preference and suppression controls,
          including send-time eligibility checks. These controls do not replace
          the Organization&apos;s responsibility to select lawful recipients,
          maintain accurate sender and mailing-address information, and honor
          requests received outside the Service. Attempts to bypass a recipient
          opt-out or provider suppression are prohibited.
        </P>
      </Section>

      <Divider />

      <Section id="sms" title="8. SMS Services and Messaging Credits">
        <P>
          SMS and related messaging features may be delivered through one or
          more independent messaging providers, carriers, registration
          partners, and aggregators (“Messaging Providers”). Church Admin may
          facilitate onboarding, purchase messaging capacity from a Messaging
          Provider, or resell messaging credits to an Organization.
        </P>
        <P>
          Messaging credits, carrier charges, registration fees, number fees,
          and other messaging charges are separate from the Church Admin
          subscription unless a checkout page or written order expressly says
          otherwise. Credits are usage units, not cash, deposits, bank balances,
          or ownership interests. They are not redeemable for cash or
          transferable between Organizations. The price, included segments,
          validity, and refund treatment shown at purchase control that
          purchase.
        </P>
        <P>
          One message may consume multiple segments based on length, encoding,
          personalization, attachments, destination, and provider or carrier
          rules. Estimates are not guarantees. Provider and carrier charges,
          registration requirements, throughput, and filtering rules may change.
        </P>
        <P>Before sending any message, the Organization must:</P>
        <Ul>
          <Li>Obtain and retain legally sufficient, recipient-specific consent for the sender and messaging purpose</Li>
          <Li>Use accurate sender identification and required disclosures</Li>
          <Li>Honor STOP, revocation, suppression, and other reasonable opt-out requests promptly</Li>
          <Li>Not rely solely on possession of a phone number as proof of consent</Li>
          <Li>Comply with the TCPA, FCC rules, state laws, carrier requirements, and Messaging Provider policies</Li>
          <Li>Not send unlawful, misleading, harassing, emergency, or prohibited content</Li>
        </Ul>
        <P>
          Suppression and consent tools are safeguards, not legal advice.
          Church attestations and records do not transfer compliance
          responsibility to Davola or a Messaging Provider. Provider approval,
          registration, phone-number availability, deliverability, and
          uninterrupted messaging are not guaranteed. Messaging Providers may
          review, filter, block, suspend, or terminate traffic under their own
          terms and legal obligations.
        </P>
        <P>
          Message and data rates may apply to recipients. Carriers are not
          liable for delayed or undelivered messages. SMS must not be used as
          the sole channel for emergencies, safety-critical notices, or urgent
          pastoral care.
        </P>
      </Section>

      <Divider />

      <Section id="forms" title="9. Forms, Links, and Submissions">
        <P>
          Organizations may create and publish forms, intake links, and QR
          codes; collect responses; export responses; map answers to standard
          or custom person fields; and create or update member and visitor
          records. Public links may be accessible without a Church Admin
          account.
        </P>
        <P>The Organization is responsible for:</P>
        <Ul>
          <Li>Form questions, descriptions, branding, disclosures, and requested information</Li>
          <Li>Providing an appropriate privacy notice and obtaining required consent</Li>
          <Li>Restricting collection of sensitive information and protecting shared links</Li>
          <Li>Reviewing mappings and proposed record changes before saving them</Li>
          <Li>Handling submissions, exports, and respondent requests lawfully</Li>
        </Ul>
        <P>
          Anti-abuse controls may reject or challenge submissions. They do not
          guarantee that a response is genuine, accurate, safe, or submitted by
          the person named in it.
        </P>
      </Section>

      <Divider />

      <Section id="ai" title="10. Nikky AI Assistant">
        <P>
          Nikky is an optional, read-only conversational interface that uses a
          third-party large-language-model API to interpret requests and
          present information returned through approved Church Admin tools.
          Nikky does not receive database credentials or unrestricted database,
          web, file, or API access.
        </P>
        <P>
          AI output may be incomplete, outdated, or incorrect. Users must
          review important answers, calculations, classifications, and reports
          against underlying records. Nikky is not professional financial,
          legal, tax, medical, counseling, safeguarding, or pastoral advice.
          Usage limits may pause Nikky without affecting other Church Admin
          features.
        </P>
      </Section>

      <Divider />

      <Section id="minors" title="11. Minors and Sensitive Information">
        <P>
          Organizations may store information about children, religious
          affiliation, donations, attendance, follow-up needs, and other
          potentially sensitive matters. The Organization is responsible for
          determining whether collection is appropriate, limiting access, and
          obtaining parental, guardian, or other consent required by law.
        </P>
        <P>
          Church Admin is not directed to children for independent account
          creation. Organizations should not use public forms to collect
          government identifiers, payment credentials, medical records, or
          similarly high-risk information unless expressly supported and
          lawfully configured.
        </P>
      </Section>

      <Divider />

      <Section id="acceptable-use" title="12. Acceptable Use">
        <P>You may not use the Service to:</P>
        <Ul>
          <Li>Break the law, violate rights, or evade consent and opt-out requirements</Li>
          <Li>Send spam, phishing, deceptive, harassing, abusive, or malicious content</Li>
          <Li>Upload malware or attempt unauthorized access, probing, scraping, or disruption</Li>
          <Li>Misrepresent identity, authority, consent, nonprofit status, or registration information</Li>
          <Li>Sell, broker, or exploit personal information without lawful authority</Li>
          <Li>Reverse engineer or circumvent security, plan, rate, or usage controls except where law permits</Li>
          <Li>Use the Service for emergency dispatch, life-safety, or other high-risk purposes</Li>
        </Ul>
        <P>
          We may investigate suspected misuse and cooperate with providers,
          carriers, regulators, or law enforcement as legally required.
        </P>
      </Section>

      <Divider />

      <Section id="third-parties" title="13. Third-Party Services">
        <P>
          The Service relies on third parties for hosting, authentication,
          email, payments, fraud and abuse prevention, AI processing, file
          generation, and messaging. Their services may be governed by
          additional terms and privacy policies. We are not responsible for
          third-party services outside our reasonable control.
        </P>
        <P>
          An Organization may need to provide additional information to a
          payment or Messaging Provider and may be required to accept provider
          terms before using a feature. Church Admin does not guarantee that a
          provider will approve, continue serving, or assign a requested number
          to an Organization.
        </P>
      </Section>

      <Divider />

      <Section id="ownership" title="14. Intellectual Property">
        <P>
          Davola and its licensors own the Service, software, design, branding,
          documentation, and related intellectual property, excluding
          Organization Data. Subject to these Terms, we grant authorized users
          a limited, revocable, non-exclusive, non-transferable right to use
          the Service for the Organization’s internal administration.
        </P>
        <P>
          If you provide feedback, you grant us permission to use it without
          restriction or compensation, provided we do not publicly identify
          confidential Organization Data in doing so.
        </P>
      </Section>

      <Divider />

      <Section id="availability" title="15. Availability and Changes">
        <P>
          The Service is provided “as is” and “as available.” We may maintain,
          modify, replace, suspend, or discontinue features. We do not warrant
          uninterrupted availability, error-free operation, delivery of
          communications, preservation of every record, or fitness for a
          particular purpose. Free plans have no service-level agreement.
        </P>
        <P>
          Beta, preview, and provider-pending features may change or never
          become generally available. Organizations should maintain exports or
          independent records where required for legal, financial, pastoral, or
          operational continuity.
        </P>
      </Section>

      <Divider />

      <Section id="termination" title="16. Suspension, Cancellation, and Deletion">
        <P>
          An owner may cancel a subscription through available billing tools.
          Cancellation stops future renewal but generally does not shorten the
          current paid term. Subscription cancellation is not an Organization
          deletion request.
        </P>
        <P>
          We may restrict or suspend access for nonpayment, security risk,
          unlawful conduct, provider or carrier direction, violation of these
          Terms, or harm to the Service or others. Where reasonable, we will
          provide notice and an opportunity to cure.
        </P>
        <P>
          A separately confirmed permanent-deletion action may remove
          Organization Data, subject to backups, legal obligations, billing
          records, fraud-prevention data, suppression records, and
          non-user-deletable audits that we are permitted or required to retain.
        </P>
      </Section>

      <Divider />

      <Section id="disclaimers" title="17. Disclaimers">
        <P>
          To the maximum extent permitted by law, Davola disclaims all express
          and implied warranties, including merchantability, fitness for a
          particular purpose, title, and non-infringement. We do not warrant
          the accuracy of user-entered data, generated reports, AI output,
          recipient matches, consent records, provider estimates, tax results,
          or accounting classifications.
        </P>
      </Section>

      <Divider />

      <Section id="liability" title="18. Limitation of Liability">
        <P>
          To the maximum extent permitted by law, Davola and its affiliates,
          officers, employees, contractors, and providers will not be liable
          for indirect, incidental, special, consequential, exemplary, or
          punitive damages; lost revenue, donations, data, goodwill, or
          opportunities; communication failures; regulatory penalties; or
          business interruption.
        </P>
        <P>
          Our aggregate liability arising from the Service will not exceed the
          greater of (a) the amount paid to Davola for the affected Service
          during the 12 months before the event giving rise to the claim or
          (b) US $100. Some jurisdictions do not allow certain limitations, so
          portions of this section may not apply.
        </P>
      </Section>

      <Divider />

      <Section id="indemnity" title="19. Indemnification">
        <P>
          To the extent permitted by law, the Organization will defend,
          indemnify, and hold harmless Davola and its affiliates, officers,
          employees, and contractors from third-party claims, losses, fines,
          and reasonable expenses arising from Organization Data, messages,
          forms, consent practices, use of the Service, violation of these
          Terms, or violation of law or another person’s rights.
        </P>
      </Section>

      <Divider />

      <Section id="disputes" title="20. Disputes and Governing Law">
        <P>
          Before filing a formal claim, each party agrees to give the other a
          written description of the dispute and 30 days to attempt an informal
          resolution. Notices to Davola may be sent to
          hello@churchadmins.com.
        </P>
        <P>
          Except for eligible small-claims matters or requests for injunctive
          relief concerning misuse or intellectual property, disputes will be
          resolved by binding individual arbitration administered by the
          American Arbitration Association under its applicable rules. Claims
          may not be brought as a class, collective, consolidated, or
          representative action.
        </P>
        <P>
          You may opt out of arbitration by emailing
          hello@churchadmins.com within 30 days after first accepting these
          Terms, stating your name, Organization, account email, and intent to
          opt out. These Terms are governed by Tennessee law, without regard to
          conflict-of-law rules, and courts located in Tennessee have exclusive
          jurisdiction over claims not subject to arbitration.
        </P>
      </Section>

      <Divider />

      <Section id="general" title="21. General Terms">
        <P>
          These Terms, the Privacy Policy, any order form, and any incorporated
          policies are the entire agreement for the Service. If an order form
          conflicts with these Terms, the order form controls for that
          purchase. You may not assign these Terms without our consent; we may
          assign them in connection with a reorganization, financing, merger,
          acquisition, or sale of assets.
        </P>
        <P>
          If a provision is unenforceable, it will be modified to the minimum
          extent necessary and the remainder will continue. Failure to enforce
          a provision is not a waiver. Headings are for convenience only.
        </P>
      </Section>

      <Divider />

      <Section id="changes" title="22. Changes to These Terms">
        <P>
          We may update these Terms. If a change is material, we will provide
          reasonable notice through the Service, by email, or by updating the
          Effective Date. Continued use after the updated Terms take effect
          constitutes acceptance, except where law requires additional consent.
        </P>
      </Section>

      <Divider />

      <Section id="contact" title="23. Contact">
        <P>
          Davola Technologies LLC
          <br />
          Email:{" "}
          <a
            href="mailto:hello@churchadmins.com"
            className="font-medium text-blue-700 underline underline-offset-2"
          >
            hello@churchadmins.com
          </a>
        </P>
      </Section>
    </LegalLayout>
  );
}
