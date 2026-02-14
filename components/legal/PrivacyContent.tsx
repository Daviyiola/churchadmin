import LegalLayout from "./LegalLayout";
import { Toc, Section, P, Ul, Li, Divider } from "./LegalBlocks";

const TOC = [
  { id: "overview", label: "1. Overview" },
  { id: "collect", label: "2. Information We Collect" },
  { id: "children", label: "3. Children’s Information" },
  { id: "use", label: "4. How We Use Information" },
  { id: "security", label: "5. Data Storage & Security" },
  { id: "retention", label: "6. Data Retention" },
  { id: "global", label: "7. Global Users" },
  { id: "cookies", label: "8. Cookies & Tracking" },
  { id: "ownership", label: "9. Data Ownership" },
  { id: "liability", label: "10. Limitation of Liability" },
  { id: "changes", label: "11. Changes to This Policy" },
  { id: "contact", label: "12. Contact" },
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
            <span className="font-medium">Entity:</span> Church Admin, LLC (to be
            incorporated in Texas, United States)
          </div>
        </div>
      }
    >
      <Toc items={TOC} />

      <Section id="overview" title="1. Overview">
        <P>
          Church Admin (“we,” “our,” or “us”) provides a church administration
          and bookkeeping software platform designed to help churches manage
          attendance, members, donations, and internal communications.
        </P>
        <P>
          This Privacy Policy explains how we collect, use, store, and protect
          information when churches and their authorized users access our
          platform.
        </P>
        <P>
          Church Admin acts primarily as a service provider to churches. Churches
          control the data entered into the platform and are responsible for
          ensuring that they have appropriate rights and permissions to provide
          that data.
        </P>
      </Section>

      <Divider />

      <Section id="collect" title="2. Information We Collect">
        <P className="font-medium">A. Account Information</P>
        <P>When a church creates an account, we may collect:</P>
        <Ul>
          <Li>Church name</Li>
          <Li>Administrator name</Li>
          <Li>Email address</Li>
          <Li>Login credentials (managed securely via Supabase authentication)</Li>
        </Ul>
        <P>
          Passwords are securely hashed and managed through Supabase
          authentication services. We do not store plaintext passwords.
        </P>

        <P className="font-medium">B. Member &amp; People Records (Provided by Churches)</P>
        <P>Churches may store the following data within the platform:</P>
        <Ul>
          <Li>First name (required)</Li>
          <Li>Last name (required)</Li>
          <Li>Gender (required)</Li>
          <Li>Age group (required)</Li>
          <Li>Email (optional)</Li>
          <Li>Phone number (optional)</Li>
          <Li>Address (optional)</Li>
          <Li>Date of birth (optional)</Li>
          <Li>Conversion date (optional)</Li>
          <Li>Baptism date (optional)</Li>
          <Li>Attendance records</Li>
          <Li>Donation amounts</Li>
          <Li>Follow-up notes</Li>
        </Ul>

        <P>We do not collect or store:</P>
        <Ul>
          <Li>Credit card numbers</Li>
          <Li>Bank account details</Li>
          <Li>Online payment credentials</Li>
        </Ul>

        <P>Payment methods recorded are limited to:</P>
        <Ul>
          <Li>Cash</Li>
          <Li>Cheque</Li>
          <Li>Online (method classification only, not payment data)</Li>
        </Ul>
      </Section>

      <Divider />

      <Section id="children" title="3. Children’s Information">
        <P>
          Church Admin allows churches to store attendance and basic member
          information for minors (e.g., ages 1–12 and 13–17).
        </P>
        <P>
          Church Admin acts as a data processor/service provider. The church
          using the platform is responsible for obtaining any required parental
          or guardian consent under applicable laws, including the U.S. Children’s
          Online Privacy Protection Act (COPPA).
        </P>
        <P>
          We do not knowingly collect children’s data directly from minors. All
          data is entered by authorized church representatives.
        </P>
      </Section>

      <Divider />

      <Section id="use" title="4. How We Use Information">
        <P>We use information to:</P>
        <Ul>
          <Li>Provide and maintain the platform</Li>
          <Li>Authenticate users</Li>
          <Li>Send transactional emails (e.g., account notices, password resets)</Li>
          <Li>Enforce subscription limits and plan features</Li>
          <Li>Improve system stability and performance</Li>
          <Li>Prevent abuse or unauthorized access</Li>
        </Ul>
        <P>
          We may send product updates or feature announcements in the future.
          Users may opt out of non-essential communications where required by law.
        </P>
      </Section>

      <Divider />

      <Section id="security" title="5. Data Storage & Security">
        <Ul>
          <Li>Data is hosted in the United States.</Li>
          <Li>Infrastructure is provided by Supabase (PostgreSQL database).</Li>
          <Li>Access controls are enforced at the application and role level.</Li>
          <Li>We use industry-standard technical safeguards.</Li>
        </Ul>
        <P>
          While we take reasonable security measures, no system can be guaranteed
          100% secure.
        </P>
        <P>
          Backups may be enabled in future infrastructure upgrades, but we do not
          guarantee data recovery unless explicitly stated in a separate agreement.
        </P>
      </Section>

      <Divider />

      <Section id="retention" title="6. Data Retention">
        <P className="font-medium">Active Subscription</P>
        <P>Data retention varies by subscription tier:</P>
        <Ul>
          <Li>Free Plan: 90 days of data access</Li>
          <Li>Basic Plan: Up to 2 years</Li>
          <Li>Pro Plan: Up to 5 years</Li>
          <Li>Enterprise Plan: Extended or unlimited retention</Li>
        </Ul>

        <P className="font-medium">Account Cancellation</P>
        <P>If a church cancels its subscription:</P>
        <Ul>
          <Li>Data will be retained for up to 30 days.</Li>
          <Li>After 30 days, data will be permanently deleted from active systems.</Li>
        </Ul>
        <P>We are not responsible for failure to export data prior to deletion.</P>
      </Section>

      <Divider />

      <Section id="global" title="7. Global Users">
        <P>
          Church Admin is operated from the United States but may be accessed
          globally. By using the platform, you consent to the transfer and storage
          of your data in the United States.
        </P>
      </Section>

      <Divider />

      <Section id="cookies" title="8. Cookies & Tracking">
        <P>
          At this time, we do not use third-party analytics or tracking tools.
          If analytics are implemented in the future, this policy will be updated
          accordingly.
        </P>
      </Section>

      <Divider />

      <Section id="ownership" title="9. Data Ownership">
        <P>Churches retain ownership of the data they enter into the platform.</P>
        <P>
          Church Admin does not claim ownership of member records, donation
          records, or internal church data.
        </P>
      </Section>

      <Divider />

      <Section id="liability" title="10. Limitation of Liability">
        <P>
          Church Admin is a bookkeeping and administrative software platform. We
          do not provide accounting, tax, legal, or financial advice.
        </P>
        <P>We are not responsible for:</P>
        <Ul>
          <Li>Incorrect data entry</Li>
          <Li>Misclassification of donations</Li>
          <Li>Compliance with tax or nonprofit reporting laws</Li>
          <Li>Loss of data due to force majeure events</Li>
        </Ul>
      </Section>

      <Divider />

      <Section id="changes" title="11. Changes to This Policy">
        <P>
          We may update this Privacy Policy from time to time. Material changes
          will be posted on our website with an updated effective date.
        </P>
      </Section>

      <Divider />

      <Section id="contact" title="12. Contact">
        <P>
          Church Admin, LLC
          <br />
          [Insert Business Address Once Formed]
          <br />
          Email: [Insert Support Email]
        </P>
      </Section>
    </LegalLayout>
  );
}
