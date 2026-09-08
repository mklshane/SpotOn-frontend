import { LanguagePicker } from '@/components/ui/language-picker';
import { getIntlLocale, t, useLocale } from '@/lib/i18n';
import { ApiError } from "@/api/client";
import { ThemedText } from "@/components/themed-text";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { SettingsRow } from "@/components/ui/settings-row";
import { TextField } from "@/components/ui/text-field";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { Space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { clearAllLocalData } from "@/lib/auth-api";
import {
  getRemindersEnabled,
  getSelfCheckReminderDueAt,
  setRemindersEnabled,
} from "@/lib/notifications";
import {
  changePassword,
  deleteAccount,
  isNotDeployed,
  requestDataExport,
} from "@/lib/settings-api";

const SUPPORT_EMAIL = "help.spoton@gmail.com";

function formatConsentStatus(
  user: { consent_data_privacy: boolean; consent_at: string | null } | null,
): string {
  if (!user?.consent_data_privacy) return t("Not granted");
  if (!user.consent_at) return t("Granted");
  const d = new Date(user.consent_at);
  return `${t("Granted on")} ${d.toLocaleDateString(getIntlLocale(), { year: "numeric", month: "short", day: "numeric" })}`;
}

export default function SettingsScreen() {
  useLocale();
  const theme = useTheme();
  const { user, signOut } = useAuth();

  // Notifications
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  const [reminderDueAt, setReminderDueAt] = useState<string | null>(null);
  useEffect(() => {
    getRemindersEnabled().then(setRemindersEnabledState);
    getSelfCheckReminderDueAt().then(setReminderDueAt);
  }, []);

  async function handleToggleReminders(next: boolean) {
    setRemindersEnabledState(next); // optimistic
    // Switching on can fail: it needs OS notification permission, and the user can refuse it (or
    // have refused it before, in which case the OS won't even prompt).
    const actual = await setRemindersEnabled(next);
    setRemindersEnabledState(actual);
    setReminderDueAt(await getSelfCheckReminderDueAt());
    if (next && !actual) {
      Alert.alert(
        t("Notifications are off"),
        t("SpotOn needs permission to send notifications before it can remind you to re-check a spot. You can turn them on in your device settings."),
        [
          { text: t("Not now"), style: "cancel" },
          { text: t("Open settings"), onPress: () => Linking.openSettings() },
        ],
      );
    }
  }

  const reminderSublabel = (() => {
    if (!remindersEnabled) return t("Reminders to re-check a spot after 30 days");
    if (!reminderDueAt) return t("On — set after your next low-risk result");
    const due = new Date(reminderDueAt);
    return `${t("Next reminder on")} ${due.toLocaleDateString(getIntlLocale(), { year: "numeric", month: "short", day: "numeric" })}`;
  })();

  // Change password (inline form)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleChangePassword() {
    setPasswordError(null);
    if (!currentPassword || !newPassword) {
      setPasswordError("Enter both your current and new password.");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordForm(false);
      Alert.alert(t("Password changed"), t("Your password has been updated."));
    } catch (e) {
      setPasswordError(
        isNotDeployed(e)
          ? "This isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : "Couldn't change your password. Check your connection and try again.",
      );
    } finally {
      setPasswordSubmitting(false);
    }
  }

  // Delete account
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
      await clearAllLocalData();
      await signOut();
      router.replace("/(auth)/login");
    } catch (e) {
      Alert.alert(
        t("Could not delete account"),
        isNotDeployed(e)
          ? t("This isn't available yet — check back soon.")
          : e instanceof ApiError
            ? e.detail
            : t("Something went wrong. Please try again."),
      );
      setDeleting(false);
    }
  }

  // Data export
  const [exporting, setExporting] = useState(false);

  async function handleDataExport() {
    setExporting(true);
    try {
      await requestDataExport();
      Alert.alert(
        t("Export requested"),
        t("We'll email your data export within a few days."),
      );
    } catch (e) {
      Alert.alert(
        t("Could not request export"),
        isNotDeployed(e)
          ? t("Data export isn't available yet — check back soon.")
          : e instanceof ApiError
            ? e.detail
            : t("Something went wrong. Please try again."),
      );
    } finally {
      setExporting(false);
    }
  }

  const appVersion = Constants.expoConfig?.version ?? t("Unknown");

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
            accessibilityLabel={t("Back")}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name="chevron.left" tintColor={theme.brand} size={20} />
          </Pressable>
        </View>
        <ThemedText type="largeTitle">{t("Settings")}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {t("Manage your account and preferences")}</ThemedText>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.sectionHead}><ThemedText type="title2">{t("Preferences")}</ThemedText></View>
          <Card style={styles.section}><LanguagePicker /></Card>
          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("Account & Security")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="key.fill"
              label={t("Change password")}
              onPress={() => setShowPasswordForm((s) => !s)}
            />
            {showPasswordForm ? (
              <View style={styles.passwordForm}>
                <TextField
                  label={t("Current password")}
                  secure
                  textContentType="password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                />
                <TextField
                  label={t("New password")}
                  secure
                  textContentType="newPassword"
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                {passwordError ? (
                  <ThemedText type="footnote" themeColor="riskCritical">
                    {t(passwordError)}
                  </ThemedText>
                ) : null}
                <Button
                  label={t("Update password")}
                  variant="outline"
                  loading={passwordSubmitting}
                  onPress={handleChangePassword}
                />
              </View>
            ) : null}
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="trash.fill"
              label={deleting ? t("Deleting…") : t("Delete account")}
              destructive
              onPress={
                deleting ? undefined : () => setConfirmDeleteVisible(true)
              }
            />
          </Card>

          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("Notifications")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="bell.fill"
              label={t("Re-screening reminders")}
              sublabel={reminderSublabel}
              accessory="switch"
              switchValue={remindersEnabled}
              onSwitchChange={handleToggleReminders}
            />
          </Card>

          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("Privacy & Data")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="shield.fill"
              label={t("Data privacy consent")}
              sublabel={formatConsentStatus(user)}
              accessory={null}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="doc.text.fill"
              label={exporting ? t("Requesting export…") : t("Request data export")}
              onPress={exporting ? undefined : handleDataExport}
            />
          </Card>

          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("About & Support")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="info.circle.fill"
              label={t("App version")}
              sublabel={appVersion}
              accessory={null}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="envelope.fill"
              label={t("Help & support")}
              sublabel={SUPPORT_EMAIL}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="doc.text.fill"
              label={t("Terms and Conditions")}
              onPress={() => router.push("/profile/terms")}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="lock.fill"
              label={t("Privacy Policy")}
              onPress={() => router.push("/profile/privacy")}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={confirmDeleteVisible}
        title={t("Delete your account? This can't be undone.")}
        onClose={() => setConfirmDeleteVisible(false)}
        options={[
          {
            key: "delete",
            label: t("Delete account"),
            destructive: true,
            onPress: handleDeleteAccount,
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  sectionHead: {
    marginTop: Space.xxl,
    marginBottom: Space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  section: { gap: 0, paddingVertical: Space.sm },
  sectionSpaced: { marginTop: Space.base },
  passwordForm: { gap: Space.base, paddingVertical: Space.base },
  pressed: {
    opacity: 0.84,
  },
});
