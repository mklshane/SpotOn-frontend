import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { SettingsRow } from "@/components/ui/settings-row";
import { Space } from "@/constants/theme";
import { useBlockAndroidBack } from "@/hooks/use-android-back";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { t, useLocale } from "@/lib/i18n";
import { markDataRightsSeen } from "@/lib/product-tour-storage";

type Right = { icon: IconName; label: string; sublabel: string; href: string };

// Data-subject rights under RA 10173, each pointing at the place in the app where it is exercised.
// The full wording lives in the Privacy Policy (section 14); this is the short version.
const RIGHTS: Right[] = [
  {
    icon: "doc.text.fill",
    label: "Know what we collect",
    sublabel: "What we collect, why, and how long we keep it",
    href: "/profile/privacy",
  },
  {
    icon: "arrow.up.doc.fill",
    label: "Get a copy of your data",
    sublabel: "Back up my data saves your screenings and photos to a file you keep",
    href: "/profile/settings",
  },
  {
    icon: "person.fill",
    label: "Correct your details",
    sublabel: "Fix your name, birthday, sex or skin type in Edit profile",
    href: "/profile/edit",
  },
  {
    icon: "trash.fill",
    label: "Delete your data",
    sublabel: "Delete a screening from its result, or your whole account in Settings",
    href: "/profile/settings",
  },
  {
    icon: "person.2.fill",
    label: "Say no to sharing",
    sublabel: "Nothing is shared for research unless you turn it on, and you can stop anytime",
    href: "/profile/settings",
  },
  {
    icon: "envelope.fill",
    label: "Raise a concern",
    sublabel: "Contact the SpotOn team, or complain to the National Privacy Commission",
    href: "/profile/privacy?section=contact",
  },
];

/**
 * "Your data, your rights". New sign-ups land here once, before the product tour (`first=1`):
 * no way back, only "Got it", which records the acknowledgment. Settings opens it as a normal page.
 */
export default function DataRightsScreen() {
  useLocale();
  const theme = useTheme();
  const { user } = useAuth();
  const first = useLocalSearchParams<{ first?: string }>().first === "1";
  const [saving, setSaving] = useState(false);
  useBlockAndroidBack(first);

  async function handleAcknowledge() {
    if (!user) return;
    setSaving(true);
    await markDataRightsSeen(user.id).catch((e) => console.warn("[rights] could not save:", e));
    // Home starts the product tour once this is no longer pending.
    router.dismissTo("/home");
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ gestureEnabled: !first }} />
      <View style={styles.header}>
        <View style={[styles.headerGlow, { backgroundColor: theme.brandTint }]} pointerEvents="none" />
        {first ? (
          <View style={[styles.badge, { backgroundColor: theme.brandTint }]}>
            <Icon name="lock.shield.fill" tintColor={theme.brand} size={22} />
          </View>
        ) : (
          <View style={styles.headerTop}>
            <Pressable
              hitSlop={12}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("Back")}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Icon name="chevron.left" tintColor={theme.brand} size={20} />
            </Pressable>
          </View>
        )}
        <ThemedText type="largeTitle">{t("Your data, your rights")}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {t("Your screenings stay on this phone. You control them, and here's how.")}
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          {RIGHTS.map((right) => (
            <SettingsRow
              key={right.label}
              icon={right.icon}
              label={t(right.label)}
              sublabel={t(right.sublabel)}
              onPress={() => router.push(right.href as never)}
            />
          ))}
        </Card>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.footnote}>
          {t("You can come back to this anytime from Settings.")}
        </ThemedText>
      </ScrollView>

      {first ? (
        <View style={styles.footer}>
          <Button label={t("Got it")} loading={saving} onPress={handleAcknowledge} />
        </View>
      ) : null}
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
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Space.md,
  },
  content: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    paddingBottom: Space.xl,
  },
  section: { gap: 0, paddingVertical: Space.sm },
  footnote: { marginTop: Space.sm, paddingHorizontal: Space.xs },
  footer: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    paddingBottom: Space.base,
  },
  pressed: {
    opacity: 0.84,
  },
});
