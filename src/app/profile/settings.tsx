import { ApiError } from '@/api/client';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/themed-text';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { clearAllLocalData } from '@/lib/auth-api';
import { getRemindersEnabled, setRemindersEnabled } from '@/lib/notifications';
import {
  changePassword,
  deleteAccount,
  isNotDeployed,
  requestDataExport,
} from '@/lib/settings-api';

const SUPPORT_EMAIL = 'help.spoton@gmail.com';

function formatConsentStatus(user: { consent_data_privacy: boolean; consent_at: string | null } | null): string {
  if (!user?.consent_data_privacy) return 'Not granted';
  if (!user.consent_at) return 'Granted';
  const d = new Date(user.consent_at);
  return `Granted on ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  // Notifications
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  useEffect(() => {
    getRemindersEnabled().then(setRemindersEnabledState);
  }, []);

  async function handleToggleReminders(next: boolean) {
    setRemindersEnabledState(next); // optimistic
    await setRemindersEnabled(next);
  }

  // Change password (inline form)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleChangePassword() {
    setPasswordError(null);
    if (!currentPassword || !newPassword) {
      setPasswordError('Enter both your current and new password.');
      return;
    }
    setPasswordSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setShowPasswordForm(false);
      Alert.alert('Password changed', 'Your password has been updated.');
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
      router.replace('/(auth)/login');
    } catch (e) {
      Alert.alert(
        'Could not delete account',
        isNotDeployed(e)
          ? "This isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : 'Something went wrong. Please try again.',
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
      Alert.alert('Export requested', "We'll email your data export within a few days.");
    } catch (e) {
      Alert.alert(
        'Could not request export',
        isNotDeployed(e)
          ? "Data export isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.detail
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  const appVersion = Constants.expoConfig?.version ?? 'Unknown';

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Settings
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="caption" themeColor="brand" style={styles.sectionTitle}>
            ACCOUNT & SECURITY
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="key.fill"
              label="Change password"
              onPress={() => setShowPasswordForm((s) => !s)}
            />
            {showPasswordForm ? (
              <View style={styles.passwordForm}>
                <TextField
                  label="Current password"
                  secure
                  textContentType="password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                />
                <TextField
                  label="New password"
                  secure
                  textContentType="newPassword"
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                {passwordError ? (
                  <ThemedText type="footnote" themeColor="riskCritical">
                    {passwordError}
                  </ThemedText>
                ) : null}
                <Button
                  label="Update password"
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
              label={deleting ? 'Deleting…' : 'Delete account'}
              destructive
              onPress={deleting ? undefined : () => setConfirmDeleteVisible(true)}
            />
          </Card>

          <ThemedText type="caption" themeColor="brand" style={styles.sectionTitle}>
            NOTIFICATIONS
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="bell.fill"
              label="Re-screening reminders"
              sublabel="Occasional reminders to check your skin"
              accessory="switch"
              switchValue={remindersEnabled}
              onSwitchChange={handleToggleReminders}
            />
          </Card>

          <ThemedText type="caption" themeColor="brand" style={styles.sectionTitle}>
            PRIVACY & DATA
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow
              icon="shield.fill"
              label="Data privacy consent"
              sublabel={formatConsentStatus(user)}
              accessory={null}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="doc.text.fill"
              label={exporting ? 'Requesting export…' : 'Request data export'}
              onPress={exporting ? undefined : handleDataExport}
            />
          </Card>

          <ThemedText type="caption" themeColor="brand" style={styles.sectionTitle}>
            ABOUT & SUPPORT
          </ThemedText>
          <Card style={styles.section}>
            <SettingsRow icon="info.circle.fill" label="App version" sublabel={appVersion} accessory={null} />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="envelope.fill"
              label="Help & support"
              sublabel={SUPPORT_EMAIL}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="doc.text.fill"
              label="Terms of Service"
              onPress={() => router.push('/profile/terms')}
            />
          </Card>

          <Card style={[styles.section, styles.sectionSpaced]}>
            <SettingsRow
              icon="lock.fill"
              label="Privacy Policy"
              onPress={() => router.push('/profile/privacy')}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={confirmDeleteVisible}
        title="Delete your account? This can't be undone."
        onClose={() => setConfirmDeleteVisible(false)}
        options={[
          {
            key: 'delete',
            label: 'Delete account',
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
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  content: { paddingHorizontal: Space.xl, paddingTop: Space.base, paddingBottom: Space.xxl },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6, marginTop: Space.xl, marginBottom: Space.base },
  section: { gap: 0, paddingVertical: Space.md },
  sectionSpaced: { marginTop: Space.base },
  passwordForm: { gap: Space.base, paddingVertical: Space.base },
});
