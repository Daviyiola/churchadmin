import LegalLayout from "./LegalLayout";
import { Divider, Li, P, Section, Toc, Ul } from "./LegalBlocks";

const TOC = [
  { id: "overview", label: "1. Overview and Scope" },
  { id: "roles", label: "2. Our Data-Processing Role" },
  { id: "collect", label: "3. Information We Collect" },
  { id: "forms", label: "4. Public Forms and Respondents" },
  { id: "use", label: "5. How We Use Information" },
  { id: "nikky", label: "6. Nikky AI Assistant" },
  { id: "communications", label: "7. Email and SMS Data" },
  { id: "sharing", label: "8. How We Disclose Information" },
  { id: "sale", label: "9. No Sale or Behavioral Advertising" },
  { id: "retention", label: "10. Retention and Deletion" },
  { id: "security", label: "11. Security" },
  { id: "choices", label: "12. Rights and Choices" },
  { id: "children", label: "13. Children and Sensitive Information" },
  { id: "cookies", label: "14. Cookies and Anti-Abuse Tools" },
  { id: "international", label: "15. International Access" },
  { id: "third-party", label: "16. Third-Party Services and Links" },
  { id: "changes", label: "17. Changes to This Policy" },
  { id: "contact", label: "18. Contact" },
];

export default function PrivacyContent() {
  return (
    <LegalLayout
      title="Privacy Policy"
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

      <Section id="overview" title="1. Overview and Scope">
        <P>
          This Privacy Policy explains how Davola Technologies LLC (“Davola,”
          “we,” “us,” or “our”) collects, uses, discloses, and retains
          information in connection with Church Admin, including our websites,
          applications, public forms, and related services (collectively, the
          “Service”).
        </P>
        <P>
          Church Admin helps churches, ministries, fellowships, nonprofits, and
          similar organizations (“Organizations”) manage people, attendance,
          finances, forms, communications, schedules, reports, and related
          administration.
        </P>
        <P>
          This Policy applies to account users, Organization representatives,
          website visitors, support contacts, and people who submit information
          through a Church Admin-hosted form. An Organization may provide
          additional privacy notices governing how it uses information.
        </P>
      </Section>

      <Divider />

      <Section id="roles" title="2. Our Data-Processing Role">
        <P>
          For records an Organization enters or collects through Church Admin,
          the Organization generally determines why and how the information is
          used. The Organization is typically the controller or business, and
          Davola acts as its processor or service provider.
        </P>
        <P>
          Organizations are responsible for their notices, legal basis,
          permissions, consent practices, data accuracy, user roles, and
          responses to members, visitors, donors, volunteers, employees, and
          form respondents.
        </P>
        <P>
          Davola acts as a controller or business for information we use for
          account administration, billing, security, fraud prevention, support,
          legal compliance, and operation of our own website and business.
        </P>
      </Section>

      <Divider />

      <Section id="collect" title="3. Information We Collect">
        <P>Depending on how the Service is used, we may process:</P>

        <P className="font-medium">Account and Organization Information</P>
        <Ul>
          <Li>Name, email address, authentication data, role, and account identifiers</Li>
          <Li>Organization name, logo, timezone, settings, plan, and user memberships</Li>
          <Li>Invitations, access changes, onboarding responses, and support communications</Li>
        </Ul>

        <P className="font-medium">People and Ministry Records</P>
        <Ul>
          <Li>Member, first-timer, visitor, volunteer, group, and department information</Li>
          <Li>Names, contact details, addresses, dates of birth or partial birthdays, gender, age group, and demographics</Li>
          <Li>Membership, baptism, conversion, attendance, schedule, assignment, and follow-up information</Li>
          <Li>Custom fields, notes, tags, status, profile changes, merge history, and processing audits</Li>
        </Ul>

        <P className="font-medium">Financial and Reporting Records</P>
        <Ul>
          <Li>Income, giving, expense, category, method, vendor, donor, and transaction information</Li>
          <Li>Published and draft entries, revisions, reports, exports, and report filters</Li>
          <Li>We do not use Church Admin to store donor bank credentials or payment-card numbers</Li>
        </Ul>

        <P className="font-medium">Forms and Communications</P>
        <Ul>
          <Li>Form definitions, fields, versions, links, submissions, answers, exports, and field mappings</Li>
          <Li>Email addresses, phone numbers, recipient selections, message content, templates, delivery events, and suppressions</Li>
          <Li>Consent attestations, opt-in evidence, opt-out events, campaign purpose, and communication history</Li>
        </Ul>

        <P className="font-medium">Billing and Transaction Information</P>
        <Ul>
          <Li>Plan, billing interval, customer and subscription identifiers, invoices, payment status, and billing address</Li>
          <Li>Messaging-credit purchases, usage, adjustments, provider charges, and related transaction metadata</Li>
          <Li>Our payment processor—not Church Admin—handles full payment-card details</Li>
        </Ul>

        <P className="font-medium">Technical and Usage Information</P>
        <Ul>
          <Li>IP address, browser and device information, timestamps, referring pages, and diagnostic logs</Li>
          <Li>Feature usage, security events, rate-limit events, errors, and performance information</Li>
          <Li>Approximate location inferred from IP or billing information where needed for security, tax, or service operation</Li>
        </Ul>
      </Section>

      <Divider />

      <Section id="forms" title="4. Public Forms and Respondents">
        <P>
          Organizations may publish Church Admin forms or intake links that can
          be opened without signing in. The Organization chooses the questions,
          requested information, purpose, availability, and how a response is
          processed.
        </P>
        <P>
          A submission may remain in a form inbox, be exported, or be reviewed
          and mapped into a member, first-timer, visitor, or custom-field
          record. Church Admin does not automatically know that the respondent
          is the same person as an existing record merely because names or
          contact details resemble each other.
        </P>
        <P>
          If you submitted a form for an Organization and wish to access,
          correct, or delete the response, contact that Organization first.
          Davola may assist the Organization where appropriate.
        </P>
      </Section>

      <Divider />

      <Section id="use" title="5. How We Use Information">
        <P>We use information to:</P>
        <Ul>
          <Li>Provide, personalize, maintain, and support the Service</Li>
          <Li>Authenticate users and enforce Organization, role, and finance-window permissions</Li>
          <Li>Store, search, organize, merge, display, export, and report Organization records</Li>
          <Li>Process form submissions and user-approved record changes</Li>
          <Li>Prepare and deliver authorized email or SMS communications</Li>
          <Li>Operate subscriptions, enforce plan limits, process purchases, and provide billing support</Li>
          <Li>Prevent abuse, enforce suppressions, investigate incidents, and protect users and the Service</Li>
          <Li>Measure reliability, troubleshoot errors, and improve functionality and user experience</Li>
          <Li>Comply with law and enforce our agreements</Li>
        </Ul>
        <P>
          We may create aggregated or de-identified information that does not
          reasonably identify an Organization or person and use it for service
          operation, security, analytics, and improvement.
        </P>
      </Section>

      <Divider />

      <Section id="nikky" title="6. Nikky AI Assistant">
        <P>
          Nikky is an optional, read-only conversational assistant available to
          authorized Organization roles. Church Admin uses the OpenAI API to
          interpret natural-language requests and present information obtained
          through a restricted set of approved Church Admin tools.
        </P>
        <P>
          OpenAI does not receive Church Admin database credentials,
          unrestricted database access, arbitrary SQL access, or authority to
          browse an Organization’s records. To answer a request, Church Admin
          may send the user’s message, limited recent conversation context, and
          compact results returned by approved queries to the OpenAI API.
        </P>
        <P>
          Church Admin stores saved conversations so a user can reopen them.
          Conversations remain until that user deletes them. Separate audit
          logs record safe metadata about access and tool usage rather than
          full donor lists, member profiles, or financial datasets, and are
          generally retained for one year. Temporary generated-report artifacts
          are generally scheduled to expire after 24 hours.
        </P>
        <P>
          We do not train or fine-tune Nikky on Organization records. OpenAI
          states that inputs and outputs from its API platform are not used to
          train its models by default unless the API customer explicitly opts
          in. Learn more in{" "}
          <a
            href="https://openai.com/business-data/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 underline underline-offset-2"
          >
            OpenAI’s business data privacy statement
          </a>
          .
        </P>
        <P>
          AI-generated responses can still be incorrect. Users should verify
          important information against current Church Admin records and
          generated reports.
        </P>
      </Section>

      <Divider />

      <Section id="communications" title="7. Email and SMS Data">
        <P>
          When an Organization uses communication features, we process message
          content, sender information, recipient details, audience filters,
          delivery metadata, and suppression or opt-out records to prepare,
          send, secure, and document communications.
        </P>
        <P>
          If SMS becomes active for an Organization, phone numbers, message
          content, sender and campaign identifiers, consent evidence, opt-out
          status, and delivery events may be shared with messaging providers,
          registration partners, aggregators, and mobile carriers as necessary
          to register senders, deliver messages, prevent abuse, calculate
          charges, and comply with law and carrier requirements.
        </P>
        <P>
          Mobile phone information, SMS opt-in data, and consent records are not
          sold or shared with third parties for their own marketing or
          promotional purposes. They may be disclosed to service providers and
          carriers solely to operate and support the messaging program, enforce
          consent and opt-outs, or as required by law.
        </P>
        <P>
          Suppression records may be retained after other records are deleted
          so that we and the Organization can continue honoring an opt-out and
          avoid sending unwanted messages.
        </P>
        <P>
          Optional church-email preferences are kept separately for each
          Organization. We also process safe delivery metadata and provider
          events such as acceptance, hard bounce, complaint, and suppression.
          A provider-level hard bounce or complaint may prevent delivery across
          Church Admin, while a church-topic opt-out applies only to that
          Organization. We do not retain complete email contents in preference
          or suppression audit records.
        </P>
      </Section>

      <Divider />

      <Section id="sharing" title="8. How We Disclose Information">
        <P>We may disclose information:</P>
        <Ul>
          <Li>To Organization users according to current roles and permissions</Li>
          <Li>To vendors that provide hosting, authentication, storage, email, AI, payments, anti-abuse, support, document generation, and messaging services</Li>
          <Li>To payment networks, financial institutions, tax services, and fraud-prevention partners for billing and transactions</Li>
          <Li>To messaging providers, registration partners, aggregators, and carriers for approved SMS services</Li>
          <Li>When directed or authorized by the Organization</Li>
          <Li>When required by law or reasonably necessary to protect rights, safety, security, and service integrity</Li>
          <Li>In connection with a financing, merger, acquisition, reorganization, or sale of assets, subject to appropriate safeguards</Li>
        </Ul>
        <P>
          Key providers may include Supabase for database, authentication, and
          storage infrastructure; Stripe for subscriptions and payments; Resend
          for email delivery; Cloudflare for form anti-abuse checks; OpenAI for
          Nikky; and one or more future Messaging Providers for SMS. Providers
          may change as the Service evolves.
        </P>
      </Section>

      <Divider />

      <Section id="sale" title="9. No Sale or Behavioral Advertising">
        <P>
          We do not sell Organization Data or personal information submitted to
          Church Admin. We do not share Organization Data with third parties
          for their own direct marketing, and we do not use it for
          cross-context behavioral advertising.
        </P>
        <P>
          A purchase of messaging capacity from a provider, or resale of
          messaging credits to an Organization, is a service transaction and
          does not constitute the sale of recipient personal information.
        </P>
      </Section>

      <Divider />

      <Section id="retention" title="10. Retention and Deletion">
        <P>
          We retain information for as long as reasonably necessary to provide
          the Service, fulfill the purposes described in this Policy, comply
          with law, resolve disputes, enforce agreements, and protect the
          Service. Retention depends on the record and context:
        </P>
        <Ul>
          <Li>Organization records generally remain until an authorized user deletes them or a confirmed Organization-deletion process is completed.</Li>
          <Li>Subscription cancellation or downgrade does not automatically delete Organization records.</Li>
          <Li>Forms and submissions remain until deleted under available Organization controls.</Li>
          <Li>Nikky conversations remain until their owner deletes them; Nikky audit metadata is generally retained for one year.</Li>
          <Li>Billing, transaction, consent, suppression, security, merge, and other audit records may be retained longer where needed for legal, accounting, safety, or fraud-prevention purposes.</Li>
          <Li>Temporary files, expired links, previews, and report artifacts may use shorter operational retention periods.</Li>
        </Ul>
        <P>
          Deletion from active systems may not immediately remove information
          from backups. Backup copies are isolated and removed or overwritten
          on normal schedules unless retention is legally required.
        </P>
      </Section>

      <Divider />

      <Section id="security" title="11. Security">
        <P>
          We use reasonable administrative, technical, and organizational
          measures designed to protect information. Measures may include
          authentication, role-based authorization, organization isolation,
          database row-level security, encryption in transit, restricted
          service credentials, audit logging, rate limits, and provider
          security controls.
        </P>
        <P>
          No method of storage or transmission is completely secure. Users and
          Organizations must protect credentials, configure roles carefully,
          secure exports and public links, and notify us promptly of suspected
          misuse.
        </P>
      </Section>

      <Divider />

      <Section id="choices" title="12. Rights and Choices">
        <P>
          Depending on your location and relationship with us, you may have
          rights to request access, correction, deletion, portability,
          restriction, or information about how personal information is used.
          You may also have the right to appeal a decision or lodge a complaint
          with a regulator.
        </P>
        <P>
          Account users can update certain information through the Service and
          may unsubscribe from optional product communications. Church-email
          recipients may use a no-sign-in preference center to control
          broadcasts, follow-ups, form invitations, and giving statements for
          each Organization. Service, account invitation, billing, security,
          and material legal notices may still be sent when necessary.
        </P>
        <P>
          Requests concerning Organization-controlled records should be
          directed to the relevant Organization first. For information Davola
          controls, contact hello@churchadmins.com. We may verify identity and
          authority before fulfilling a request.
        </P>
      </Section>

      <Divider />

      <Section id="children" title="13. Children and Sensitive Information">
        <P>
          Organizations may use Church Admin to store information about minors,
          religious affiliation, giving, attendance, pastoral follow-up, and
          other potentially sensitive matters. The Organization is responsible
          for deciding what to collect, obtaining any required parental or
          guardian consent, providing notices, and complying with COPPA and
          other applicable laws.
        </P>
        <P>
          Church Admin is not directed to children for independent account
          creation, and Davola does not knowingly collect personal information
          directly from children apart from an Organization’s use of the
          Service. If you believe information was collected improperly, contact
          the Organization or Davola.
        </P>
      </Section>

      <Divider />

      <Section id="cookies" title="14. Cookies and Anti-Abuse Tools">
        <P>
          We use cookies, local storage, tokens, and similar technologies that
          are necessary for sign-in, security, organization selection,
          preferences, and Service operation. We may also use limited
          diagnostics to understand errors and performance.
        </P>
        <P>
          Public forms may use Cloudflare Turnstile or similar anti-abuse
          technology. That provider may process IP address, browser, device,
          challenge, and security information to distinguish legitimate use
          from automated abuse under its own privacy terms.
        </P>
      </Section>

      <Divider />

      <Section id="international" title="15. International Access">
        <P>
          Davola operates Church Admin from the United States, and primary
          service infrastructure is currently located in the United States. If
          you access the Service from another country, information may be
          transferred to and processed in the United States or other locations
          where our providers operate. Those locations may have different data
          protection laws.
        </P>
        <P>
          Organizations are responsible for determining whether their use of
          Church Admin complies with applicable local law and whether additional
          notices, agreements, or transfer safeguards are required.
        </P>
      </Section>

      <Divider />

      <Section id="third-party" title="16. Third-Party Services and Links">
        <P>
          The Service may link to or integrate with third-party websites and
          services. Their privacy practices are governed by their own policies,
          not this Policy. Stripe may act as a processor and/or controller for
          payment and fraud-prevention information. Messaging Providers and
          carriers may process communications under their own legal duties and
          policies.
        </P>
        <P>
          We encourage Organizations and users to review relevant provider
          policies, particularly before enabling payments, AI, public forms, or
          messaging.
        </P>
      </Section>

      <Divider />

      <Section id="changes" title="17. Changes to This Policy">
        <P>
          We may update this Privacy Policy as the Service, providers, or laws
          change. If changes are material, we will provide reasonable notice
          through the Service, by email, or by updating the Effective Date.
          Where required, we will seek additional consent.
        </P>
      </Section>

      <Divider />

      <Section id="contact" title="18. Contact">
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
