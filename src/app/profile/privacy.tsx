import { ThemedText } from "@/components/themed-text";
import { DocumentHeader } from "@/components/ui/document-header";
import { Screen } from "@/components/ui/screen";
import { ContactLink } from "@/components/ui/settings-row";
import { router } from "expo-router";
import { Linking, ScrollView, StyleSheet, View } from "react-native";

import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const LAST_UPDATED = "August 2026";
const CONTACT_EMAIL = "help.spoton@gmail.com";

/** Committed turnaround for data-subject requests (section 15). */
const RESPONSE_WINDOW = "15 working days";

/** Close of the thesis evaluation period, after which retention winds down (section 11). */
const PROJECT_END = "October 2026";

/**
 * Where the account database lives — read off the Supabase session-pooler host in
 * SpotOn-backend/api/.env (`aws-1-ap-southeast-1.pooler.supabase.com`).
 */
const DB_REGION = "Singapore (AWS ap-southeast-1)";

/**
 * Where the API service itself runs. render.yaml pins no `region:`, so the deploy took
 * Render's default — confirmed by the service's origin CNAME, which encodes the region:
 *   spoton-api.onrender.com -> gcp-us-west1-1.origin.onrender.com
 * Re-check that CNAME if the service is ever moved to another region.
 */
const API_REGION = "Oregon, USA (GCP us-west1)";

/**
 * Official DLSL Data Protection Officer address (section 19). Rendered only when set;
 * until then section 19 points to the University's official channels instead.
 *
 * TODO(thesis): confirm with the adviser / DLSL Privacy Office.
 */
const DPO_CONTACT: string | null = null;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="title2" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText type="caption" themeColor="brand" style={styles.subHeading}>
      {children}
    </ThemedText>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText type="subhead" style={styles.paragraph}>
      {children}
    </ThemedText>
  );
}

function Bullet({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: theme.brand }]} />
      <ThemedText type="subhead" style={styles.bulletText}>
        {label ? (
          <ThemedText type="subhead" style={styles.bulletLabel}>
            {label}:{" "}
          </ThemedText>
        ) : null}
        {children}
      </ThemedText>
    </View>
  );
}

/** Inline tappable link that opens an external URL in the system browser. */
function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <ThemedText
      type="subhead"
      themeColor="brand"
      style={styles.inlineLink}
      onPress={() => Linking.openURL(url)}
    >
      {label}
    </ThemedText>
  );
}

/** Inline tappable link to the Terms and Conditions. */
function TermsLink() {
  return (
    <ThemedText
      type="subhead"
      themeColor="brand"
      style={styles.inlineLink}
      onPress={() => router.push("/profile/terms")}
    >
      Terms and Conditions
    </ThemedText>
  );
}

export default function PrivacyPolicyScreen() {
  return (
    <Screen padded={false}>
      <DocumentHeader title="Privacy Policy" />
      <View style={styles.header}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Last Updated: {LAST_UPDATED}
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Section title="1. Introduction">
          <Paragraph>
            SpotOn (“SpotOn,” “we,” “our,” or “the application”) is a research
            prototype developed as part of an academic thesis project at De La
            Salle Lipa (DLSL).
          </Paragraph>
          <Paragraph>
            This Privacy Policy explains what personal information SpotOn
            collects, how that information is processed, where it is stored, how
            it is protected, and what rights you have over your information.
          </Paragraph>
          <Paragraph>
            SpotOn is designed for academic research, demonstration, and
            evaluation purposes. Because the application processes information
            that may relate to a person&apos;s health, we take the protection of
            this information seriously.
          </Paragraph>
          <Paragraph>
            SpotOn processes personal information in accordance with applicable
            Philippine privacy laws, including Republic Act No. 10173, otherwise
            known as the Data Privacy Act of 2012 (DPA), and its applicable
            implementing rules and regulations. The DPA requires processing to
            observe the principles of transparency, legitimate purpose, and
            proportionality.
          </Paragraph>
        </Section>

        <Section title="2. Who Is Responsible for Your Personal Information?">
          <Paragraph>
            The personal information collected through SpotOn is processed in
            connection with the academic research project at De La Salle Lipa.
          </Paragraph>
          <Bullet label="Project">
            SpotOn — Smartphone-Based Early Skin Cancer Risk Detection
          </Bullet>
          <View style={styles.contactRow}>
            <ThemedText type="subhead" style={styles.contactLabel}>
              Project contact:
            </ThemedText>
            <ContactLink email={CONTACT_EMAIL} subject="SpotOn Privacy Policy" />
          </View>
        </Section>

        <Section title="3. Information We Collect">
          <Paragraph>
            We collect only information that is reasonably necessary for the
            application&apos;s functionality, account management, research
            evaluation, and security. Depending on the features you use, SpotOn
            may process the following categories of information.
          </Paragraph>

          <SubHeading>A. Account Information</SubHeading>
          <Paragraph>When you create an account, we may collect:</Paragraph>
          <Bullet>full name;</Bullet>
          <Bullet>email address;</Bullet>
          <Bullet>telephone number;</Bullet>
          <Bullet>date of birth;</Bullet>
          <Bullet>sex;</Bullet>
          <Bullet>account credentials or authentication information; and</Bullet>
          <Bullet>the date and record of your privacy consent.</Bullet>

          <SubHeading>B. Health-Related and Skin Information</SubHeading>
          <Paragraph>
            To support the application&apos;s screening functionality, SpotOn
            may process information such as:
          </Paragraph>
          <Bullet>Fitzpatrick skin type;</Bullet>
          <Bullet>skin-lesion photographs;</Bullet>
          <Bullet>photographs of skin areas;</Bullet>
          <Bullet>responses to skin-related questionnaires;</Bullet>
          <Bullet>
            responses concerning symptoms or lesion characteristics;
          </Bullet>
          <Bullet>
            screening results and risk or urgency classifications; and
          </Bullet>
          <Bullet>
            other information voluntarily entered during a screening.
          </Bullet>
          <Paragraph>
            Some of this information may constitute sensitive personal
            information, particularly information relating to health. Under the
            Data Privacy Act, information concerning an individual&apos;s health
            is classified as sensitive personal information.
          </Paragraph>

          <SubHeading>C. Profile Photograph</SubHeading>
          <Paragraph>
            If you choose to upload a profile or avatar photograph, that
            photograph will be associated with your account. Uploading a profile
            photograph is optional unless otherwise indicated by the
            application.
          </Paragraph>

          <SubHeading>D. Location Information</SubHeading>
          <Paragraph>
            SpotOn may request access to your device&apos;s location when you
            use location-dependent functionality, such as finding or displaying
            nearby dermatological clinics. Location access is not required for
            the core skin-image classification functionality.
          </Paragraph>

          <SubHeading>E. Technical and Usage Information</SubHeading>
          <Paragraph>
            The application and its supporting infrastructure may process
            information necessary to operate, secure, troubleshoot, and maintain
            the service, such as:
          </Paragraph>
          <Bullet>device or application information;</Bullet>
          <Bullet>authentication information;</Bullet>
          <Bullet>network or connection information;</Bullet>
          <Bullet>timestamps;</Bullet>
          <Bullet>application errors or diagnostic information; and</Bullet>
          <Bullet>
            information necessary to maintain account and security functions.
          </Bullet>
          <Paragraph>
            SpotOn does not intentionally collect unrelated information that is
            unnecessary for its stated purposes.
          </Paragraph>
        </Section>

        <Section title="4. How We Use Your Information">
          <Paragraph>
            We process information for the following purposes.
          </Paragraph>

          <SubHeading>A. Account Management</SubHeading>
          <Paragraph>Your account information is used to:</Paragraph>
          <Bullet>create and maintain your SpotOn account;</Bullet>
          <Bullet>authenticate your account;</Bullet>
          <Bullet>maintain your profile;</Bullet>
          <Bullet>synchronize account-related information; and</Bullet>
          <Bullet>provide account-related functionality.</Bullet>

          <SubHeading>B. Skin Screening Functionality</SubHeading>
          <Paragraph>
            Skin-related photographs and questionnaire responses are used to
            operate SpotOn&apos;s experimental machine-learning screening
            functionality. The application may analyze an image and generate an
            estimated probability, classification, or urgency result. These
            results are automatically generated and are not medical diagnoses.
          </Paragraph>

          <SubHeading>C. Research and Academic Evaluation</SubHeading>
          <Paragraph>
            Information may be processed for academic research and evaluation
            associated with the SpotOn thesis project. This may include
            evaluating:
          </Paragraph>
          <Bullet>application performance;</Bullet>
          <Bullet>machine-learning performance;</Bullet>
          <Bullet>usability;</Bullet>
          <Bullet>screening workflow;</Bullet>
          <Bullet>model errors and limitations; and</Bullet>
          <Bullet>aggregated research findings.</Bullet>
          <Paragraph>
            Where possible, research analysis uses de-identified,
            pseudonymized, or aggregated information rather than directly
            identifying users. Your personal information will not be sold for
            commercial purposes.
          </Paragraph>

          <SubHeading>D. Location-Based Features</SubHeading>
          <Paragraph>
            When you enable a location-related feature, location information may
            be used to provide map or nearby-clinic functionality.
          </Paragraph>

          <SubHeading>E. Security and Maintenance</SubHeading>
          <Paragraph>
            Information may be processed when necessary to:
          </Paragraph>
          <Bullet>authenticate users;</Bullet>
          <Bullet>detect unauthorized activity;</Bullet>
          <Bullet>maintain application security;</Bullet>
          <Bullet>troubleshoot technical problems; and</Bullet>
          <Bullet>protect the integrity of the research system.</Bullet>
        </Section>

        <Section title="5. Legal Basis for Processing">
          <Paragraph>
            SpotOn processes personal information based on applicable lawful
            processing grounds under the Data Privacy Act.
          </Paragraph>
          <Paragraph>
            Where processing involves sensitive personal information, including
            health-related information, SpotOn relies on an applicable legal
            basis recognized under the DPA, including specific, informed consent
            where required. The DPA generally requires consent for processing
            sensitive personal information unless another statutory exception
            applies.
          </Paragraph>
          <Paragraph>
            Where consent is the applicable legal basis, we obtain your consent
            before processing begins. Consent is freely given, specific,
            informed, and recorded together with the date it was given.
          </Paragraph>
        </Section>

        <Section title="6. How Your Skin Images Are Processed">
          <SubHeading>On-Device Processing</SubHeading>
          <Paragraph>
            SpotOn&apos;s machine-learning image classification is designed to
            run directly on your device. When an image is analyzed:
          </Paragraph>
          <Bullet>the image is selected or captured on the device;</Bullet>
          <Bullet>the machine-learning model processes the image locally;</Bullet>
          <Bullet>the application generates the screening output; and</Bullet>
          <Bullet>
            the image and screening history may remain within SpotOn&apos;s
            private application storage on the device.
          </Bullet>
          <Paragraph>
            Lesion photographs are not routinely uploaded to SpotOn&apos;s
            application servers solely to perform machine-learning
            classification. This means that SpotOn&apos;s server does not need
            to receive your lesion photograph in order to perform the core
            classification process.
          </Paragraph>

          <SubHeading>Important Distinction</SubHeading>
          <Paragraph>
            Your lesion images may still exist in the application&apos;s local
            storage after analysis if the screening history feature saves them.
            Local storage on your device is separate from the server-side
            account database.
          </Paragraph>
        </Section>

        <Section title="7. Where Your Data Is Stored">
          <Paragraph>
            SpotOn uses two general categories of storage.
          </Paragraph>

          <SubHeading>A. Local Device Storage</SubHeading>
          <Paragraph>
            Screening photographs and related screening history may be stored
            within SpotOn&apos;s private application storage on your device.
            This information is subject to the security protections provided by
            the device operating system and application sandbox.
          </Paragraph>
          <Paragraph>
            SpotOn does not apply an additional application-level AES encryption
            layer to locally stored images, and does not claim such protection
            unless it is specifically implemented.
          </Paragraph>

          <SubHeading>B. Server-Side Storage</SubHeading>
          <Paragraph>
            Account-related information may be stored in the application&apos;s
            backend database or cloud infrastructure, hosted in {DB_REGION}.
            This may include information such as:
          </Paragraph>
          <Bullet>name;</Bullet>
          <Bullet>email address;</Bullet>
          <Bullet>telephone number;</Bullet>
          <Bullet>date of birth;</Bullet>
          <Bullet>sex;</Bullet>
          <Bullet>Fitzpatrick skin type;</Bullet>
          <Bullet>account information;</Bullet>
          <Bullet>profile photograph; and</Bullet>
          <Bullet>
            screening-related metadata or results where applicable.
          </Bullet>
          <Paragraph>
            The exact categories stored server-side may change as the research
            prototype is updated.
          </Paragraph>
        </Section>

        <Section title="8. Third-Party Service Providers">
          <Paragraph>
            SpotOn uses third-party infrastructure providers to operate portions
            of the application. These providers include backend and database
            infrastructure providers, and map or map-tile providers used for
            location and map functionality.
          </Paragraph>
          <Paragraph>
            Where third-party services process personal information on behalf of
            SpotOn, they are subject to appropriate contractual,
            organizational, and technical safeguards consistent with applicable
            privacy requirements.
          </Paragraph>

          <SubHeading>Cloud and Backend Providers</SubHeading>
          <Paragraph>
            SpotOn&apos;s account database is hosted on Supabase (managed
            PostgreSQL cloud infrastructure) in {DB_REGION}. See{" "}
            <ExternalLink
              url="https://supabase.com/privacy"
              label="supabase.com/privacy"
            />
            .
          </Paragraph>
          <Paragraph>
            The application programming interface that connects the app to that
            database is hosted on Render in {API_REGION}. See{" "}
            <ExternalLink
              url="https://render.com/privacy"
              label="render.com/privacy"
            />
            .
          </Paragraph>
          <Paragraph>
            Because these providers operate outside the Philippines, account
            information processed through SpotOn is stored and processed abroad.
            The research team remains accountable for that information under the
            Data Privacy Act, and these providers act as processors on
            SpotOn&apos;s behalf.
          </Paragraph>

          <SubHeading>Map Services</SubHeading>
          <Paragraph>
            When map functionality is used, SpotOn requests map tiles and
            related map resources from MapTiler. Providing a map requires
            sending the information necessary to identify the requested map
            area, which is derived from your approximate location, together with
            your device&apos;s network address. SpotOn does not send your
            precise coordinates to the map provider, and clinic distances are
            calculated on your device rather than on a server. See{" "}
            <ExternalLink
              url="https://www.maptiler.com/privacy-policy/"
              label="maptiler.com/privacy-policy"
            />
            .
          </Paragraph>
          <Paragraph>
            SpotOn does not sell your personal information to these providers.
          </Paragraph>
        </Section>

        <Section title="9. Data Sharing and Disclosure">
          <Paragraph>
            SpotOn does not sell, rent, or trade your personal information or
            skin photographs for advertising or commercial data brokerage.
          </Paragraph>
          <Paragraph>
            Information may nevertheless be disclosed or made accessible in
            limited circumstances, including:
          </Paragraph>
          <Bullet>
            to authorized members of the research team who require access for
            legitimate project purposes;
          </Bullet>
          <Bullet>
            to authorized institutional personnel where necessary for research
            oversight, ethics, security, or compliance;
          </Bullet>
          <Bullet>
            to contracted service providers that operate infrastructure used by
            SpotOn;
          </Bullet>
          <Bullet>where required or permitted by applicable law; or</Bullet>
          <Bullet>
            where necessary to protect the rights, safety, or security of users
            or the application.
          </Bullet>
          <Paragraph>
            Access to sensitive information is limited to individuals who
            require it for an authorized purpose.
          </Paragraph>
        </Section>

        <Section title="10. Research Data and De-Identification">
          <Paragraph>
            SpotOn may use pseudonymization or de-identification techniques when
            analyzing research data. For example, a record may be associated
            with a randomized identifier rather than displaying a user&apos;s
            name.
          </Paragraph>
          <Paragraph>
            However, pseudonymization does not necessarily make information
            anonymous. If information can still reasonably be linked to an
            identifiable user through additional information, it continues to be
            treated as personal information and protected accordingly.
          </Paragraph>
          <Paragraph>
            Research results may be reported in aggregate form so that
            individual participants are not unnecessarily identified.
          </Paragraph>
        </Section>

        <Section title="11. Data Retention">
          <Paragraph>
            SpotOn retains personal information only for as long as reasonably
            necessary for the purposes described in this Privacy Policy, subject
            to applicable legal, institutional, research, and security
            requirements.
          </Paragraph>

          <SubHeading>Local Screening Data</SubHeading>
          <Paragraph>
            Screening images and history stored locally on your device remain
            there until they are deleted through the application&apos;s
            available controls, removed as part of application data deletion, or
            otherwise removed from the device. Uninstalling the application may
            remove locally stored application data, depending on the operating
            system and device configuration.
          </Paragraph>

          <SubHeading>Server-Side Account Data</SubHeading>
          <Paragraph>
            Account information stored on SpotOn&apos;s backend will be retained
            for the duration necessary to operate the research prototype and
            fulfill legitimate academic, security, and legal requirements. The
            evaluation period is expected to conclude in {PROJECT_END}.
          </Paragraph>
          <Paragraph>
            Following completion of the research project, the research team
            intends to securely delete or appropriately de-identify personal
            information that is no longer required. We do not claim that all
            information is permanently deleted immediately upon thesis
            completion, because some information may need to be retained for
            legal or institutional reasons.
          </Paragraph>
        </Section>

        <Section title="12. Data Security">
          <Paragraph>
            SpotOn implements reasonable technical and organizational measures
            appropriate to the nature of the information being processed. These
            may include:
          </Paragraph>
          <Bullet>encrypted communication using HTTPS/TLS;</Bullet>
          <Bullet>authentication and access controls;</Bullet>
          <Bullet>restricted access to backend systems;</Bullet>
          <Bullet>secure cloud infrastructure;</Bullet>
          <Bullet>application-level access restrictions; and</Bullet>
          <Bullet>appropriate security practices for research data.</Bullet>
          <Paragraph>
            Data stored by third-party infrastructure providers may also be
            protected using security mechanisms provided by those services.
          </Paragraph>
          <Paragraph>
            No electronic system can guarantee absolute security. Therefore,
            while reasonable safeguards are implemented, SpotOn cannot guarantee
            that unauthorized access, disclosure, alteration, or destruction
            will never occur.
          </Paragraph>
        </Section>

        <Section title="13. Data Breaches and Security Incidents">
          <Paragraph>
            If a security incident or personal data breach occurs, the research
            team will assess the incident and take appropriate measures in
            accordance with applicable law, institutional procedures, and
            applicable National Privacy Commission requirements.
          </Paragraph>
          <Paragraph>
            Where notification is legally required, affected individuals and the
            appropriate authorities will be notified in accordance with
            applicable requirements.
          </Paragraph>
        </Section>

        <Section title="14. Your Rights as a Data Subject">
          <Paragraph>
            Under the Data Privacy Act, you may have rights including the
            following.
          </Paragraph>
          <Bullet label="Right to be informed">
            You have the right to know whether your personal information is
            being processed and how it is being used.
          </Bullet>
          <Bullet label="Right to access">
            You may request access to personal information held about you,
            subject to applicable limitations.
          </Bullet>
          <Bullet label="Right to correct or rectify">
            You may request correction of inaccurate, incomplete, or outdated
            personal information.
          </Bullet>
          <Bullet label="Right to object">
            Where applicable, you may object to certain processing of your
            personal information.
          </Bullet>
          <Bullet label="Right to withdraw consent">
            Where processing is based on consent, you may withdraw your consent,
            subject to applicable legal or operational limitations. Withdrawal
            of consent does not invalidate processing that was lawfully
            conducted before withdrawal.
          </Bullet>
          <Bullet label="Right to erasure or blocking">
            Where applicable, you may request deletion, blocking, or restriction
            of processing of your personal information.
          </Bullet>
          <Bullet label="Right to data portability">
            Where applicable, you may request a copy of your personal
            information in a structured or commonly used format and exercise
            your right to data portability.
          </Bullet>
          <Bullet label="Right to file a complaint">
            If you believe your privacy rights have been violated, you may file
            a complaint with the National Privacy Commission (NPC).
          </Bullet>
          <Paragraph>
            These rights are recognized under the Data Privacy Act and related
            NPC guidance. Some rights may be subject to limitations or
            exceptions under applicable law.
          </Paragraph>
        </Section>

        <Section title="15. How to Exercise Your Rights">
          <Paragraph>
            To request access, correction, deletion, withdrawal of consent, or
            other privacy-related assistance, contact the SpotOn Project Team:
          </Paragraph>
          <View style={styles.contactRow}>
            <ContactLink email={CONTACT_EMAIL} subject="SpotOn data request" />
          </View>
          <Paragraph>
            Please provide enough information for the research team to identify
            your account and understand your request. For security purposes, we
            may need to verify your identity before fulfilling certain requests.
            We aim to respond within {RESPONSE_WINDOW} of receiving a verified
            request.
          </Paragraph>
        </Section>

        <Section title="16. Withdrawal from Research">
          <Paragraph>
            Participation in the SpotOn research evaluation is voluntary. You
            may stop participating or request withdrawal from the research
            activity subject to applicable research-ethics procedures and
            limitations.
          </Paragraph>
          <Paragraph>
            Withdrawal from research does not affect the lawfulness of
            processing that occurred before your withdrawal.
          </Paragraph>
          <Paragraph>
            If you wish to withdraw your data from the research dataset, contact
            the project team using the information above. If the data has
            already been irreversibly aggregated or anonymized so that it can no
            longer reasonably be associated with you, it may no longer be
            possible to identify and remove it.
          </Paragraph>
        </Section>

        <Section title="17. Children’s Privacy">
          <Paragraph>
            SpotOn is intended for individuals 18 years of age or older. We do
            not intentionally collect personal information from individuals
            under 18.
          </Paragraph>
          <Paragraph>
            If you believe that an individual under 18 has provided personal
            information to SpotOn, please contact us so that we can investigate
            and take appropriate action.
          </Paragraph>
        </Section>

        <Section title="18. Changes to This Privacy Policy">
          <Paragraph>
            This Privacy Policy may be updated when SpotOn&apos;s functionality,
            research procedures, data-processing activities, third-party
            services, or applicable requirements change.
          </Paragraph>
          <Paragraph>
            When material changes are made, the “Last Updated” date will be
            revised. Where appropriate, users will be notified through the
            application or another reasonable communication method. Previous
            versions may be retained for research, compliance, and documentation
            purposes.
          </Paragraph>
        </Section>

        <Section title="19. Contact Us">
          <Paragraph>
            For questions, concerns, data requests, or privacy complaints
            relating to SpotOn, contact the SpotOn Project Team:
          </Paragraph>
          <View style={styles.contactRow}>
            <ContactLink email={CONTACT_EMAIL} subject="SpotOn Privacy Policy" />
          </View>
          {DPO_CONTACT ? (
            <Paragraph>
              For institutional privacy concerns, you may also contact the De La
              Salle Lipa Data Protection Officer at {DPO_CONTACT}.
            </Paragraph>
          ) : (
            <Paragraph>
              For institutional privacy concerns, you may also contact the De La
              Salle Lipa Data Protection Officer through the University&apos;s
              official channels.
            </Paragraph>
          )}
        </Section>

        <Section title="20. National Privacy Commission">
          <Paragraph>
            If you believe that your personal data has been processed unlawfully
            or that your rights under Philippine data privacy law have been
            violated, you may seek assistance from or lodge a complaint with the
            National Privacy Commission of the Philippines. Official NPC
            information regarding data-subject rights and complaints is
            available through the Commission&apos;s website at{" "}
            <ExternalLink
              url="https://www.privacy.gov.ph"
              label="privacy.gov.ph"
            />
            .
          </Paragraph>
        </Section>

        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          style={styles.closing}
        >
          By creating an account and using SpotOn, you acknowledge that you have
          read this Privacy Policy and the <TermsLink />, and understand how
          your personal information may be processed for the purposes described
          above. Where consent is required, your consent will be obtained
          separately and appropriately documented.
        </ThemedText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Space.xxl,
    paddingHorizontal: Space.xl,
    paddingBottom: Space.base,
    gap: 2,
  },
  content: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    paddingBottom: Space.xxl,
  },
  section: {
    marginTop: Space.xxl,
    gap: Space.sm,
  },
  sectionTitle: {
    marginBottom: Space.xs,
  },
  subHeading: {
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: Space.sm,
  },
  paragraph: {
    lineHeight: 21,
  },
  inlineLink: {
    fontWeight: "600",
  },
  bulletRow: {
    flexDirection: "row",
    gap: Space.sm,
    paddingRight: Space.sm,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    lineHeight: 21,
  },
  bulletLabel: {
    fontWeight: "700",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Space.xs,
  },
  contactLabel: {
    marginRight: 2,
  },
  closing: {
    marginTop: Space.xxl,
    lineHeight: 19,
  },
});
