import { t, useLocale } from '@/lib/i18n';
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { IconCircle } from "@/components/ui/icon-circle";
import { Screen } from "@/components/ui/screen";
import { SettingsRow } from "@/components/ui/settings-row";
import { Gradients, Radius, Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { TourTarget } from "@/lib/product-tour";
import { computeAge, SEX_LABELS, skinTypeLabel } from "@/lib/profile-format";
import { useScanHistory } from "@/lib/scan-history";
import { TabContentInset } from '@/components/ui/tab-bar';
import { readPendingProfile } from '@/lib/profile-pending';

export default function ProfileScreen() {
  useLocale();
  const { user, signOut } = useAuth();
  const { entries } = useScanHistory();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [pendingProfile, setPendingProfile] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    if (user?.id) {
      readPendingProfile(user.id).then((pending) => {
        if (active) setPendingProfile(Boolean(pending));
      }).catch(() => {});
    } else setPendingProfile(false);
    return () => { active = false; };
  }, [user]));

  const name = user?.full_name?.trim() || "Your profile";
  const identifier = user?.email || user?.phone || "";

  const age = computeAge(user?.date_of_birth ?? null);
  const sexLabel = user?.sex ? (SEX_LABELS[user.sex] ?? user.sex) : null;
  const skinLabel = skinTypeLabel(user?.fitzpatrick_skin_type ?? null);

  const scanCount = entries.length;
  const lastScan = entries[0]?.createdAt;
  const lastScanLabel = lastScan
    ? new Date(lastScan).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace("/(auth)/login");
  }

  return (
    <Screen padded={false} edges={[]}>
      <View style={styles.hero}>
        <LinearGradient
          colors={
            Gradients.sunsetVivid.colors as unknown as [
              string,
              string,
              ...string[],
            ]
          }
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ paddingTop: insets.top + Space.md }}>
          <ThemedText
            type="title2"
            themeColor="onBrand"
            style={styles.heroTitle}
          >
            {t("Profile")}</ThemedText>

          <Pressable
            onPress={() => router.push("/profile/edit")}
            accessibilityRole="button"
            accessibilityLabel={t("Edit profile")}
            style={styles.avatarWrap}
          >
            <View style={styles.avatarFrost}>
              <Avatar
                uri={user?.avatar_url}
                name={user?.full_name ?? undefined}
                size={AVATAR}
                backgroundColor="rgba(255,255,255,0.16)"
                textColor="#FFFFFF"
              />
            </View>
            <View
              style={[styles.editBadge, { backgroundColor: theme.surface }]}
            >
              <Icon name="pencil" tintColor={theme.brand} size={13} />
            </View>
          </Pressable>

          <ThemedText
            type="title2"
            themeColor="onBrand"
            style={styles.heroName}
          >
            {name}
          </ThemedText>
          {identifier ? (
            <ThemedText
              type="footnote"
              style={[
                styles.heroIdentifier,
                { color: "rgba(255,255,255,0.8)" },
              ]}
            >
              {identifier}
            </ThemedText>
          ) : null}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                {t("AGE")}</ThemedText>
              <ThemedText type="headline" themeColor="onBrand">
                {age != null ? age : "-"}
              </ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                {t("SEX")}</ThemedText>
              <ThemedText type="headline" themeColor="onBrand">
                {sexLabel ?? "-"}
              </ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                {t("SKIN TYPE")}</ThemedText>
              <ThemedText type="headline" themeColor="onBrand">
                {skinLabel}
              </ThemedText>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
        >
          {pendingProfile ? (
            <View style={[styles.pendingNotice, { backgroundColor: theme.brandTint }]}>
              <View style={[styles.pendingDot, { backgroundColor: theme.brand }]} />
              <ThemedText type="footnote" style={{ color: theme.brand, flex: 1 }}>
                {t("Saved on this device. Will sync when online.")}
              </ThemedText>
            </View>
          ) : null}
          <ThemedText
            type="caption"
            themeColor="brand"
            style={styles.sectionLabel}
          >
            {t("ACTIVITY")}</ThemedText>
          <Card style={[styles.row, styles.compactCard]}>
            <IconCircle icon="sparkles" variant="tint" size={48} />
            <View style={styles.rowText}>
              <ThemedText type="headline">
                {scanCount === 0
                  ? t("No screenings yet")
                  : `${scanCount} ${scanCount === 1 ? "screening" : "screenings"} completed`}
              </ThemedText>
              {lastScanLabel ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {t("Last screening")} {lastScanLabel}
                </ThemedText>
              ) : null}
            </View>
          </Card>

          <TourTarget id="profileBodyMap" style={styles.menuTarget}>
            <Card style={[styles.menu, styles.compactCard, styles.flush]}>
              <SettingsRow
                icon="figure.stand"
                label={t("See body lesions")}
                sublabel={t("View your screening history on the 3D body")}
                onPress={() => router.push("/scan/history")}
              />
            </Card>
          </TourTarget>

          <Card style={[styles.menu, styles.compactCard]}>
            <SettingsRow
              icon="bookmark.fill"
              label={t("My dermatologists")}
              sublabel={t("Clinics and doctors you saved")}
              onPress={() => router.push("/profile/saved")}
            />
          </Card>

          <Card style={[styles.menu, styles.compactCard]}>
            <SettingsRow
              icon="gearshape.fill"
              label={t("Settings")}
              onPress={() => router.push("/profile/settings")}
            />
          </Card>

          <View style={styles.actions}>
            <Button
              label={t("Sign out")}
              variant="outline"
              loading={signingOut}
              onPress={handleSignOut}
            />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

const AVATAR = 88;
const EDIT_BADGE = 30;

const styles = StyleSheet.create({
  pendingNotice: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, borderRadius: 14, padding: Space.base, marginBottom: Space.lg },
  pendingDot: { width: 8, height: 8, borderRadius: 4 },
  hero: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  heroTitle: { opacity: 0.85, marginBottom: Space.lg },
  avatarWrap: { alignSelf: "center", marginBottom: Space.base },
  avatarFrost: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    overflow: "hidden",
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: EDIT_BADGE,
    height: EDIT_BADGE,
    borderRadius: EDIT_BADGE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7A2E08",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  heroName: { textAlign: "center" },
  heroIdentifier: { textAlign: "center", marginTop: 2 },
  statsRow: { flexDirection: "row", alignItems: "center", marginTop: Space.xl },
  statItem: { flex: 1, alignItems: "center", gap: Space.xs },
  statLabel: { color: "rgba(255,255,255,0.75)", letterSpacing: 0.5 },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  sheet: {
    flex: 1,
    marginTop: -Radius.xl,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  scroll: { flex: 1 },
  // Clears the floating Scan button, which protrudes above the tab bar's own
  // top edge as a sibling view this screen's layout doesn't otherwise know
  // to leave room for.
  scrollContent: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.xl,
    paddingBottom: TabContentInset,
  },
  sectionLabel: {
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: Space.base,
  },
  row: { flexDirection: "row", alignItems: "center", gap: Space.base },
  rowText: { flex: 1, gap: 2 },
  menu: { marginTop: Space.base, gap: 0, paddingVertical: Space.md },
  compactCard: { paddingVertical: Space.base },
  // A tour target carries the card's top margin so the spotlight hugs the card, not the gap.
  menuTarget: { marginTop: Space.base },
  flush: { marginTop: 0 },
  actions: { marginTop: Space.xl },
});
