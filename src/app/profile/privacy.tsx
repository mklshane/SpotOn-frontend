import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { ContactLink } from "@/components/ui/settings-row";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const LAST_UPDATED = "July, 2026";
const CONTACT_EMAIL = "help.spoton@gmail.com";

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
  const theme = useTheme();
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

export default function PrivacyPolicyScreen() {
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <View
          style={[styles.headerGlow, { backgroundColor: theme.brandTint }]}
          pointerEvents="none"
        />
        <View style={styles.headerTop}>
          <Pressable
            hitSlop={12}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
        </View>
        <ThemedText type="largeTitle">Privacy Policy</ThemedText>
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
            This Privacy Policy explains how SpotOn handles information when you
            use it. SpotOn is developed strictly for academic and research
            purposes at De La Salle Lipa, and we are committed to respecting the
            user&apos;s privacy and ensuring that any data collected is managed
            ethically and securely in accordance with academic research
            standards.
          </Paragraph>
        </Section>

        <Section title="2. About the Information We Collect">
          <Paragraph>
            Because SpotOn is a research prototype, we limit data collection to
            what is necessary for the functionalities of the application.
          </Paragraph>
          <Bullet label="Image Data">
            Photos of skin lesions or skin areas are uploaded directly to the
            application.
          </Bullet>
          <Bullet label="Optional Location Data">
            We will directly access the device&apos;s location, but only when
            the feature is being used.
          </Bullet>
        </Section>

        <Section title="3. How We Use Your Data">
          <Paragraph>
            We process your information for the following purposes:
          </Paragraph>
          <Bullet label="Core App Functionality">
            The application will analyze the image to provide a real-time
            machine learning probability output.
          </Bullet>
          <Bullet label="Location Services">
            The application will use the user&apos;s current location to show
            nearby dermatological clinics.
          </Bullet>
        </Section>

        <Section title="4. Data Storage">
          <SubHeading>Anonymization and De-identification</SubHeading>
          <Bullet>
            All uploaded images are immediately assigned a randomized,
            non-identifiable unique identifier (UUID). Personal user accounts
            are decoupled from raw image files in our backend storage to ensure
            strict data separation.
          </Bullet>

          <SubHeading>Data Encryption</SubHeading>
          <Bullet>
            Data transmitted between the user&apos;s device and our cloud
            servers is encrypted using standard TLS/HTTPS protocols.
          </Bullet>
          <Bullet>
            Uploaded images and database records are stored using
            industry-standard AES encryption.
          </Bullet>

          <SubHeading>Data Retention and Post-Thesis Handling</SubHeading>
          <Bullet>
            Data collected during this test release will be stored securely on
            cloud servers for the duration of the evaluation period. Upon
            completion of the academic project, all stored raw user photos and
            accounts will be permanently purged.
          </Bullet>
        </Section>

        <Section title="5. Third-Party Services">
          <Paragraph>
            We do not sell, rent, or trade your personal data or uploaded images
            to third parties or advertisers. To produce this application we
            utilize trusted cloud infrastructure providers (backend service).
            These services process data strictly on our behalf under secure,
            encrypted conditions.
          </Paragraph>
        </Section>

        <Section title="6. User Control and Rights">
          <Paragraph>
            Regardless of our academic testing results, we respect your rights
            regarding your data:
          </Paragraph>
          <Bullet label="Right to Access">
            You may request a copy of the personal data or scan history tied to
            your account.
          </Bullet>
          <Bullet label="Right to Erasure">
            You may request the immediate deletion of your account and all
            associated uploaded images from our backend servers at any time.
          </Bullet>
        </Section>

        <Section title="7. Contact Us">
          <Paragraph>
            If you have any questions, concerns, or data deletion requests
            regarding this Privacy Policy, please reach out to the project
            leads:
          </Paragraph>
          <View style={styles.contactRow}>
            <ThemedText type="subhead" style={styles.contactLabel}>
              Developers:
            </ThemedText>
            <ContactLink
              email={CONTACT_EMAIL}
              subject="SpotOn Privacy Policy"
            />
          </View>
        </Section>
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
  headerGlow: {
    position: "absolute",
    top: -36,
    right: -44,
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.6,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Space.sm,
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
    paddingLeft: 13,
  },
  contactLabel: {
    marginRight: 2,
  },
  pressed: {
    opacity: 0.84,
  },
});
