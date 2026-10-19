import { LanguagePicker } from '@/components/ui/language-picker';
import { BodyFigurePicker } from '@/components/ui/body-figure-picker';
import { getIntlLocale, t, useLocale } from '@/lib/i18n';
import { ApiError } from "@/api/client";
import { ThemedText } from "@/components/themed-text";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResearchConsentSheet } from "@/components/research-consent-sheet";
import { BackupPasswordDialog } from "@/components/backup-password-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { SettingsRow } from "@/components/ui/settings-row";
import { TextField } from "@/components/ui/text-field";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
import { changePassword, clearAllLocalData } from "@/lib/auth-api";
import { getRegistrationPasswordError } from "@/lib/form-validation";
import {
  getRemindersEnabled,
  getSelfCheckReminderDueAt,
  setRemindersEnabled,
} from "@/lib/notifications";
import { deleteAccount, isNotDeployed } from "@/lib/settings-api";
import { useProductTour } from "@/lib/product-tour";
import {
  countMySharedSamples,
  deleteMySharedSamples,
  setResearchConsent,
} from "@/lib/research-sharing";
import { resetScanTips } from "@/lib/product-tour-storage";
import {
  BackupError,
  buildBackup,
  countBackupItems,
  readBackup,
  restoreBackup,
} from "@/lib/backup/backup";
import type { BackupContents } from "@/lib/backup/core";
import { pickBackupFile, saveBackupFile } from "@/lib/backup/io";
import { useScanHistory } from "@/lib/scan-history";
import { isDatabaseEphemeral } from "@/data/db";

const SUPPORT_EMAIL = "help.spoton.dlsl@gmail.com";

/** iOS can't present a Modal (or the share sheet) while another is still animating away. */
const MODAL_SETTLE_MS = 400;
const settle = () => new Promise((resolve) => setTimeout(resolve, MODAL_SETTLE_MS));

function backupErrorMessage(e: unknown): string {
  switch (e instanceof BackupError ? e.code : null) {
    case "bad_file":
      return t("This file isn't a SpotOn backup, or it's damaged.");
    case "wrong_password":
      return t("Wrong password, or the file is damaged.");
    case "newer_version":
      return t("This backup was made with a newer version of SpotOn. Update the app, then try again.");
    case "empty":
      return t("There's nothing to back up yet.");
    case "ephemeral_db":
      return t("This browser can't save your history, so a restore here would be lost. Use the SpotOn app or another browser.");
    case "sharing_unavailable":
      return t("Sharing isn't available on this device.");
    default:
      return t("Something went wrong. Please try again.");
  }
}

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
  const { user, signOut, setUser } = useAuth();
  const { startReplay } = useProductTour();
  const { reload: reloadHistory } = useScanHistory();
  // Replays the screening tips by starting a screening: the body screen opens on the overview.
  const handleReplayScanTips = () => {
    if (!user) return;
    resetScanTips(user.id)
      .catch((e) => console.warn("[scan-tips] could not reset:", e))
      .finally(() => router.push("/scan/body"));
  };

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

  // expo-notifications cannot schedule anything in a browser (lib/notifications.ts bails on web),
  // so the toggle silently springs back. Say so up front instead of describing a feature the
  // user cannot have here.
  const remindersUnsupported = Platform.OS === "web";

  const reminderSublabel = (() => {
    if (remindersUnsupported) {
      return t("Not available in the browser - use the SpotOn app to get re-screening reminders");
    }
    if (!remindersEnabled) return t("Reminders to re-check a spot after 30 days");
    if (!reminderDueAt) return t("On - set after your next low-risk result");
    const due = new Date(reminderDueAt);
    return `${t("Next reminder on")} ${due.toLocaleDateString(getIntlLocale(), { year: "numeric", month: "short", day: "numeric" })}`;
  })();

  // Help improve SpotOn (optional research sharing). The whole block is hidden while the server
  // flag is off. `researchOptimistic` holds the switch position while a change is in flight.
  const researchAvailable = user?.research_sharing_enabled === true;
  const [researchOptimistic, setResearchOptimistic] = useState<boolean | null>(null);
  const researchOn = researchOptimistic ?? user?.research_consent === true;
  const [researchInfoVisible, setResearchInfoVisible] = useState(false);
  const [researchDialog, setResearchDialog] = useState<
    { kind: "withdraw" | "delete"; count: number | null } | null
  >(null);
  const [researchBusy, setResearchBusy] = useState(false);

  /** Shared-photo count for the confirm copy. Null when offline - the dialog still works. */
  async function fetchSharedCount(): Promise<number | null> {
    return countMySharedSamples().catch((e) => {
      console.warn("[research] could not count shared photos", e);
      return null;
    });
  }

  async function handleToggleResearch(next: boolean) {
    if (!user || researchBusy) return;
    if (!next) {
      // Withdrawal deletes what was shared, so say so - and how much - before doing it (NPC 2023-04).
      setResearchBusy(true);
      const count = await fetchSharedCount();
      setResearchBusy(false);
      setResearchDialog({ kind: "withdraw", count });
      return;
    }
    setResearchOptimistic(true); // optimistic
    try {
      const res = await setResearchConsent(user, true);
      setUser(res.user);
    } catch (e) {
      Alert.alert(
        t("Couldn't turn on sharing"),
        e instanceof ApiError ? e.detail : t("Check your connection and try again."),
      );
    } finally {
      setResearchOptimistic(null); // the profile, updated or not, is the truth again
    }
  }

  async function handleDeleteSharedPress() {
    if (researchBusy) return;
    setResearchBusy(true);
    const count = await fetchSharedCount();
    setResearchBusy(false);
    if (count === 0) {
      Alert.alert(t("Nothing to delete"), t("You haven't shared any photos yet."));
      return;
    }
    setResearchDialog({ kind: "delete", count });
  }

  async function handleConfirmResearchDialog() {
    if (!user || !researchDialog) return;
    const { kind } = researchDialog;
    setResearchBusy(true);
    if (kind === "withdraw") setResearchOptimistic(false);
    try {
      if (kind === "withdraw") {
        const res = await setResearchConsent(user, false);
        setUser(res.user);
      } else {
        await deleteMySharedSamples(user.id);
      }
      setResearchDialog(null);
    } catch (e) {
      // Close the dialog before alerting: an Alert stacked on an open Modal is unreliable on iOS.
      setResearchDialog(null);
      Alert.alert(
        kind === "withdraw" ? t("Couldn't turn off sharing") : t("Couldn't delete your shared photos"),
        e instanceof ApiError ? e.detail : t("Check your connection and try again."),
      );
    } finally {
      setResearchOptimistic(null);
      setResearchBusy(false);
    }
  }

  const researchDialogMessage = (() => {
    if (!researchDialog) return "";
    const { kind, count } = researchDialog;
    const what = count == null
      ? t("Any photos you've shared will be deleted from the research dataset.")
      : count === 1
        ? t("Your 1 shared photo will be deleted from the research dataset.")
        : t("Your {{count}} shared photos will be deleted from the research dataset.", { count });
    const tail = kind === "withdraw"
      ? t("New scans won't be shared. Models already trained with your photos can't un-learn them. Every feature keeps working the same.")
      : t("Sharing stays on for new scans. Models already trained with your photos can't un-learn them.");
    return `${what} ${tail}`;
  })();

  // Back up / restore. Screening history lives only on this phone, so this file is the user's way
  // to carry it across a reinstall, a new phone, or a deleted-and-recreated account.
  const [backupMode, setBackupMode] = useState<"create" | "enter" | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const pickedBackup = useRef<Uint8Array | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupContents | null>(null);
  const [restoring, setRestoring] = useState(false);

  const progressStatus = (label: string) => (p: number) =>
    setBackupStatus(`${label} ${Math.round(p * 10) * 10}%`);

  function closeBackupDialog() {
    setBackupMode(null);
    setBackupBusy(false);
    setBackupStatus(null);
    setBackupError(null);
    pickedBackup.current = null;
  }

  async function handleBackupPress() {
    if (!user || backupBusy) return;
    const count = await countBackupItems(user.id).catch(() => 0);
    if (count === 0) {
      Alert.alert(t("Nothing to back up yet"), t("Your screenings, tracked spots and saved dermatologists will appear in a backup once you have some."));
      return;
    }
    setBackupMode("create");
  }

  async function handleRestorePress() {
    if (!user || backupBusy) return;
    if (isDatabaseEphemeral()) {
      Alert.alert(t("Can't restore here"), backupErrorMessage(new BackupError("ephemeral_db", "")));
      return;
    }
    try {
      const file = await pickBackupFile();
      if (!file) return;
      pickedBackup.current = file;
      setBackupMode("enter");
    } catch (e) {
      Alert.alert(t("Couldn't open the file"), backupErrorMessage(e));
    }
  }

  async function handleBackupPassword(password: string) {
    if (!user) return;
    setBackupBusy(true);
    setBackupError(null);
    if (backupMode === "create") {
      try {
        setBackupStatus(t("Locking your backup…"));
        const { bytes, fileName } = await buildBackup(user, password, progressStatus(t("Locking your backup…")));
        closeBackupDialog();
        await settle();
        await saveBackupFile(bytes, fileName);
      } catch (e) {
        closeBackupDialog();
        Alert.alert(t("Couldn't create the backup"), backupErrorMessage(e));
      }
      return;
    }
    const file = pickedBackup.current;
    if (!file) return closeBackupDialog();
    try {
      setBackupStatus(t("Unlocking…"));
      const contents = await readBackup(file, password, progressStatus(t("Unlocking…")));
      closeBackupDialog();
      await settle();
      setRestorePreview(contents);
    } catch (e) {
      if (e instanceof BackupError && e.code === "wrong_password") {
        // Stay open so they can try again; the file is still in hand.
        setBackupBusy(false);
        setBackupStatus(null);
        setBackupError(backupErrorMessage(e));
        return;
      }
      closeBackupDialog();
      Alert.alert(t("Couldn't open the backup"), backupErrorMessage(e));
    }
  }

  async function handleConfirmRestore() {
    if (!user || !restorePreview) return;
    setRestoring(true);
    try {
      const res = await restoreBackup(restorePreview, user.id);
      await reloadHistory().catch((e) => console.warn("[backup] history reload failed", e));
      setRestorePreview(null);
      setRestoring(false);
      await settle();
      const added = t("Added {{screenings}} screenings and {{spots}} tracked spots to your history.", {
        screenings: res.added.screenings,
        spots: res.added.lesions,
      });
      const skipped = res.skipped.screenings + res.skipped.lesions;
      Alert.alert(
        t("Backup restored"),
        skipped > 0
          ? `${added} ${t("{{count}} items were already on this phone and were left as they are.", { count: skipped })}`
          : added,
      );
    } catch (e) {
      setRestorePreview(null);
      setRestoring(false);
      await settle();
      Alert.alert(t("Couldn't restore the backup"), backupErrorMessage(e));
    }
  }

  const restoreMessage = (() => {
    if (!restorePreview) return "";
    const { manifest, data } = restorePreview;
    const date = new Date(manifest.exportedAt);
    const summary = t("Backup from {{date}}: {{screenings}} screenings, {{spots}} tracked spots and {{saved}} saved dermatologists.", {
      date: Number.isNaN(date.getTime())
        ? manifest.exportedAt
        : date.toLocaleDateString(getIntlLocale(), { year: "numeric", month: "short", day: "numeric" }),
      screenings: data.screenings.length,
      spots: data.lesions.length,
      saved: data.savedItems.length,
    });
    const otherAccount = manifest.sourceAccountId !== user?.id
      ? ` ${t("It was made by another SpotOn account ({{email}}), and will be added to the account you're signed in to now.", {
          email: manifest.sourceEmail ?? t("unknown email"),
        })}`
      : "";
    return `${summary}${otherAccount} ${t("Nothing already on this phone is changed or removed.")}`;
  })();

  // Change password (inline form)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function resetPasswordForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  }

  async function handleChangePassword() {
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    // Same rule the backend enforces, so an 8-character minimum fails here
    // rather than after a round trip.
    const newPasswordError = getRegistrationPasswordError(newPassword);
    if (newPasswordError) {
      setPasswordError(newPasswordError);
      return;
    }
    // There is no password-reset flow, so a typo in the new password would lock
    // the account out for good. Confirm it before we rotate the credential.
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Your new password must be different from your current one.");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      resetPasswordForm();
      setShowPasswordForm(false);
      Alert.alert(
        t("Password changed"),
        t("Your password has been updated. Any other devices signed in to this account have been signed out."),
      );
    } catch (e) {
      setPasswordError(
        e instanceof ApiError
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
      // Close the dialog before alerting: an Alert stacked on top of an open Modal is
      // unreliable on iOS, and the user needs to read this one.
      setDeleting(false);
      setConfirmDeleteVisible(false);
      Alert.alert(
        t("Could not delete account"),
        isNotDeployed(e)
          ? t("This isn't available yet - check back soon.")
          : e instanceof ApiError
            ? e.detail
            : t("Something went wrong. Please try again."),
      );
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
          <View style={[styles.sectionHead, styles.sectionHeadFirst]}><ThemedText type="title2">{t("Preferences")}</ThemedText></View>
          <View style={styles.preferenceCards}>
            <Card style={styles.section}><LanguagePicker /></Card>
            <Card style={styles.section}><BodyFigurePicker /></Card>
          </View>
          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("Account & Security")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="key.fill"
              label={t("Change password")}
              onPress={() => {
                // Never leave a half-typed password behind a collapsed row.
                if (showPasswordForm) resetPasswordForm();
                setShowPasswordForm((open) => !open);
              }}
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
                <TextField
                  label={t("Confirm new password")}
                  secure
                  textContentType="newPassword"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <ThemedText type="footnote" themeColor="textSecondary">
                  {t("Use at least 8 characters.")}
                </ThemedText>
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
              accessory={remindersUnsupported ? null : "switch"}
              switchValue={remindersEnabled}
              onSwitchChange={handleToggleReminders}
            />
          </Card>

          <View style={styles.sectionHead}>
            <ThemedText type="title2">{t("Help & guidance")}</ThemedText>
          </View>
          <Card style={styles.section}>
            <SettingsRow
              icon="sparkles"
              label={t("Replay product tour")}
              sublabel={t("A quick guide to SpotOn's main features")}
              onPress={() => { if (user) startReplay(user.id); }}
            />
            <SettingsRow
              icon="camera.viewfinder"
              label={t("Replay screening guide")}
              sublabel={t("Walk through a screening with tips on each step")}
              onPress={handleReplayScanTips}
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
              icon="arrow.up.doc.fill"
              label={t("Back up my data")}
              sublabel={t("Save your screenings and photos to a password-protected file")}
              onPress={backupBusy ? undefined : handleBackupPress}
            />
            <SettingsRow
              icon="arrow.down.doc.fill"
              label={t("Restore from a backup")}
              sublabel={t("Bring back screenings from a SpotOn backup file")}
              onPress={backupBusy ? undefined : handleRestorePress}
            />
          </Card>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.footnote}>
            {t("Your screenings are stored only on this phone. Back them up before you delete the app, delete your account, or switch phones.")}
          </ThemedText>

          {researchAvailable ? (
            <Card style={[styles.section, styles.sectionSpaced]}>
              <SettingsRow
                icon="person.2.fill"
                label={t("Help improve SpotOn")}
                sublabel={
                  researchOn
                    ? t("On - new scans are shared with the research team, without your name")
                    : t("Off - share new scans to help SpotOn work better for Filipino skin")
                }
                accessory="switch"
                switchValue={researchOn}
                onSwitchChange={handleToggleResearch}
              />
              <SettingsRow
                icon="questionmark.circle.fill"
                label={t("What's shared?")}
                onPress={() => setResearchInfoVisible(true)}
              />
              {user?.research_consent ? (
                <SettingsRow
                  icon="trash.fill"
                  label={t("Delete my shared photos")}
                  destructive
                  onPress={researchBusy ? undefined : handleDeleteSharedPress}
                />
              ) : null}
            </Card>
          ) : null}

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

      <ConfirmDialog
        visible={confirmDeleteVisible}
        icon="trash.fill"
        destructive
        loading={deleting}
        title={t("Delete your account?")}
        message={`${t(
          "This can't be undone. Your account is removed for good, and the screening history and photos saved on this device are deleted with it.",
        )} ${t("To keep them, use Back up my data first.")}`}
        confirmLabel={deleting ? t("Deleting…") : t("Delete account")}
        cancelLabel={t("Keep my account")}
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDeleteVisible(false)}
      />

      <ConfirmDialog
        visible={researchDialog != null}
        icon={researchDialog?.kind === "delete" ? "trash.fill" : "person.2.fill"}
        destructive
        loading={researchBusy}
        title={
          researchDialog?.kind === "delete"
            ? t("Delete your shared photos?")
            : t("Stop sharing and delete shared photos?")
        }
        message={researchDialogMessage}
        confirmLabel={researchDialog?.kind === "delete" ? t("Delete photos") : t("Stop sharing")}
        cancelLabel={researchDialog?.kind === "delete" ? t("Keep them") : t("Keep sharing")}
        onConfirm={handleConfirmResearchDialog}
        onCancel={() => setResearchDialog(null)}
      />

      <BackupPasswordDialog
        visible={backupMode != null}
        mode={backupMode ?? "create"}
        loading={backupBusy}
        status={backupStatus}
        error={backupError}
        onEdit={() => setBackupError(null)}
        onSubmit={handleBackupPassword}
        onCancel={closeBackupDialog}
      />

      <ConfirmDialog
        visible={restorePreview != null}
        icon="arrow.down.doc.fill"
        loading={restoring}
        title={t("Restore this backup?")}
        message={restoreMessage}
        confirmLabel={t("Restore")}
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestorePreview(null)}
      />

      <ResearchConsentSheet
        visible={researchInfoVisible}
        mode="info"
        onClose={() => setResearchInfoVisible(false)}
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
  // The first title sits right under the header; the big gap is for separating sections.
  sectionHeadFirst: { marginTop: Space.sm },
  preferenceCards: { gap: Space.base },
  section: { gap: 0, paddingVertical: Space.sm },
  sectionSpaced: { marginTop: Space.base },
  passwordForm: { gap: Space.base, paddingVertical: Space.base },
  footnote: { marginTop: Space.sm, paddingHorizontal: Space.xs },
  pressed: {
    opacity: 0.84,
  },
});
