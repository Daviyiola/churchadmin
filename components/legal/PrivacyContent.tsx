import LegalLayout from "./LegalLayout";
import { Toc, Section, P, Ul, Li, Divider } from "./LegalBlocks";

const TOC = [
  { id: "overview", label: "1. Overview" },
  { id: "collect", label: "2. Information We Collect" },
  { id: "use", label: "3. How We Use Information" },
  { id: "sharing", label: "4. How We Share Information" },
  { id: "processing", label: "5. Data Processing Role" },
  { id: "storage", label: "6. Data Storage & Retention" },
  { id: "security", label: "7. Security" },
  { id: "nikky", label: "8. Nikky AI Assistant" },
  { id: "children", label: "9. Children’s Data" },
  { id: "rights", label: "10. Your Rights & Choices" },
  { id: "international", label: "11. International Users" },
  { id: "thirdparty", label: "12. Third-Party Services" },
  { id: "changes", label: "13. Changes to this Privacy Policy" },
  { id: "contact", label: "14. Contact" },
];

export default function PrivacyContent() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Church Admin"
      meta={
        <div className="space-y-1">
          <div>
            <span className="font-medium">Effective Date:</span> [Insert Date]
          </div>
          <div>
            <span className="font-medium">Entity:</span> Davola Technologies, LLC
            (Tennessee Limited Liability Company)
          </div>
        </div>
      }
    >
      <Toc items={TOC} />

      <Section id="overview" title="1. Overview">
        <P>
          This Privacy Policy explains how Church Admin (“Church Admin,” “we,”
          “us,” or “our”) collects, uses, stores, and shares information when
          you access or use our software platform.
        </P>
        <P>
          Church Admin is a church administration and bookkeeping platform
          designed to help churches manage records, attendance, donations,
          reporting, and internal operations.
        </P>
        <P>
          By using the Platform, you acknowledge that your information will be
          handled as described in this Privacy Policy.
        </P>
      </Section>

      <Divider />

      <Section id="collect" title="2. Information We Collect">
        <P>We may collect the following categories of information:</P>

        <P className="font-medium">Account Information</P>
        <Ul>
          <Li>Name</Li>
          <Li>Email address</Li>
          <Li>Login credentials and authentication-related data</Li>
          <Li>Organization or church account details</Li>
        </Ul>

        <P className="font-medium">Limited Financial Information</P>
        <Ul>
          <Li>Donation amounts</Li>
          <Li>Payment method labels such as cash, online, or cheque</Li>
          <Li>Basic transaction-related metadata entered by the church</Li>
        </Ul>

        <P>
          Church Admin does not store payment card numbers, bank account
          credentials, or other highly sensitive payment authentication data.
        </P>

        <P className="font-medium">Technical Information</P>
        <Ul>
          <Li>IP address</Li>
          <Li>Browser type</Li>
          <Li>Device information</Li>
          <Li>Log data</Li>
          <Li>Usage and diagnostic information</Li>
        </Ul>
      </Section>

      <Divider />

      <Section id="use" title="3. How We Use Information">
        <P>We use information to:</P>
        <Ul>
          <Li>Provide and operate the Platform</Li>
          <Li>Authenticate users and secure accounts</Li>
          <Li>
            Store and display church records submitted by authorized users
          </Li>
          <Li>Provide reporting, dashboards, and bookkeeping functionality</Li>
          <Li>Enforce plan limits and subscription features</Li>
          <Li>Respond to support requests</Li>
          <Li>Improve performance, reliability, and user experience</Li>
          <Li>Send transactional emails and service-related notices</Li>
          <Li>Comply with legal obligations</Li>
        </Ul>

        <P>We do not sell personal information submitted to the Platform.</P>
      </Section>

      <Divider />

      <Section id="sharing" title="4. How We Share Information">
        <P>We may share information only in limited circumstances:</P>
        <Ul>
          <Li>
            With service providers that help us host, operate, and secure the
            Platform
          </Li>
          <Li>When required by law, subpoena, court order, or legal process</Li>
          <Li>
            To protect the rights, safety, and security of Church Admin, users,
            or others
          </Li>
          <Li>
            In connection with a merger, acquisition, financing, or sale of
            assets
          </Li>
        </Ul>

        <P>
          We do not share church data with third parties for their independent
          marketing purposes.
        </P>
      </Section>

      <Divider />

      <Section id="processing" title="5. Data Processing Role">
        <P>
          In many cases, the church or organization using Church Admin controls
          the information entered into the Platform.
        </P>
        <P>
          In that context, the church is responsible for determining what data
          is collected, entered, updated, and deleted, as well as for ensuring
          that it has the legal right to use that data.
        </P>
        <P>
          Church Admin generally acts as a service provider or processor on
          behalf of the church for data submitted by authorized users.
        </P>
      </Section>

      <Divider />

      <Section id="storage" title="6. Data Storage & Retention">
        <P>
          Church Admin uses third-party infrastructure providers, including
          Supabase, to host and store application data.
        </P>
        <P>
          At this time, Platform data is stored on infrastructure located in the
          United States.
        </P>

        <P>Retention depends on account status and subscription tier.</P>

        <P className="font-medium">Free Plan</P>
        <Ul>
          <Li>Feature access may be limited</Li>
          <Li>Certain reporting windows may be restricted to recent data</Li>
          <Li>No service level agreement applies</Li>
        </Ul>

        <P className="font-medium">Account Cancellation</P>
        <Ul>
          <Li>
            Data may remain accessible for up to 30 days after cancellation
          </Li>
          <Li>After that period, data may be permanently deleted</Li>
        </Ul>

        <P>
          You are responsible for exporting any data you wish to keep before
          deletion occurs.
        </P>
      </Section>

      <Divider />

      <Section id="security" title="7. Security">
        <P>
          We use reasonable administrative, technical, and organizational
          measures to help protect information stored in the Platform.
        </P>
        <P>These measures may include:</P>
        <Ul>
          <Li>Authentication controls</Li>
          <Li>Role-based access controls</Li>
          <Li>Hosted database and infrastructure protections</Li>
          <Li>Monitoring and diagnostic logging</Li>
        </Ul>

        <P>
          However, no system can be guaranteed to be completely secure, and we
          cannot guarantee absolute security.
        </P>
      </Section>

      <Divider />

      <Section id="nikky" title="8. Nikky AI Assistant">
        <P>
          Church Admin may provide an optional, read-only conversational
          assistant called Nikky. Nikky helps authorized organization users ask
          questions about Church Admin records and prepare supported reports.
        </P>
        <P>
          Nikky uses the OpenAI API to interpret natural-language requests and
          produce clear responses. Church Admin authenticates the user, applies
          organization and role permissions, and executes a restricted set of
          approved queries. OpenAI does not receive database credentials,
          direct database access, arbitrary query access, or permission to
          browse Church Admin records.
        </P>
        <P>
          To provide a response, Church Admin may send the user&apos;s message,
          relevant conversation context, and limited results from approved
          queries to the OpenAI API. Church Admin does not train or fine-tune
          Nikky on an organization&apos;s records. OpenAI states that API inputs
          and outputs are not used to train its models by default unless an API
          customer explicitly opts in.
        </P>
        <P>
          Nikky is designed to ground organization-specific answers in current
          Church Admin queries, but AI-generated responses may still contain
          errors. Users should review important answers against the underlying
          records or generated reports.
        </P>
        <P>
          For more information about OpenAI&apos;s handling of business and API
          data, review{" "}
          <a
            href="https://openai.com/business-data/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 underline underline-offset-2"
          >
            OpenAI&apos;s business data privacy statement
          </a>
          .
        </P>
      </Section>

      <Divider />

      <Section id="children" title="9. Children’s Data">
        <P>
          Churches may choose to store information relating to minors in Church
          Admin.
        </P>
        <P>
          The church or organization using the Platform is solely responsible
          for obtaining any required parental or guardian consent and for
          complying with applicable child privacy and protection laws, including
          COPPA where applicable.
        </P>
        <P>
          Church Admin does not knowingly collect personal information directly
          from children independent of the church’s use of the Platform.
        </P>
      </Section>

      <Divider />

      <Section id="rights" title="10. Your Rights & Choices">
        <P>
          Depending on your role and jurisdiction, you may have the ability to:
        </P>
        <Ul>
          <Li>Access certain account information</Li>
          <Li>Update or correct account information</Li>
          <Li>Request deletion of your account</Li>
          <Li>
            Export or request access to church data, subject to account
            permissions
          </Li>
        </Ul>

        <P>
          Requests relating to church member data should generally be directed
          first to the church or organization that controls that data.
        </P>
      </Section>

      <Divider />

      <Section id="international" title="11. International Users">
        <P>Church Admin is operated from the United States.</P>
        <P>
          If you access the Platform from outside the United States, you
          understand that your information may be transferred to, stored in, and
          processed in the United States, where data protection laws may differ
          from those in your jurisdiction.
        </P>
      </Section>

      <Divider />

      <Section id="thirdparty" title="12. Third-Party Services">
        <P>
          The Platform may rely on third-party providers for infrastructure,
          authentication, email delivery, analytics, or related services.
        </P>
        <P>
          Our use of those providers does not mean their separate services,
          websites, or privacy practices are controlled by Church Admin.
        </P>
        <P>
          We encourage users to review the privacy policies of any third-party
          services they interact with through or in connection with the
          Platform.
        </P>
      </Section>

      <Divider />

      <Section id="changes" title="13. Changes to this Privacy Policy">
        <P>We may update this Privacy Policy from time to time.</P>
        <P>
          If we make material changes, we may provide notice through the
          Platform, by email, or by updating the Effective Date above.
        </P>
        <P>
          Continued use of the Platform after changes become effective
          constitutes acceptance of the updated Privacy Policy.
        </P>
      </Section>

      <Divider />

      <Section id="contact" title="14. Contact">
        <P>
          Church Admin, LLC
          <br />
          [Insert Registered Business Address Once Formed]
          <br />
          [Insert Support Email]
        </P>
      </Section>
    </LegalLayout>
  );
}
