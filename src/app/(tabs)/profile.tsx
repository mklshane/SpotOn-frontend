import { router, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useScanHistory } from '@/lib/scan-history';

const SEX_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  intersex: 'Intersex',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

const SKIN_TYPE_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  // Parse "YYYY-MM-DD" as a local date, not `new Date(dob)`'s UTC-midnight
  // parsing — the latter can roll the birth date back a day in timezones
  // behind UTC once read back via local getMonth()/getDate().
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function skinTypeLabel(type: number | null): string {
  if (type == null || type < 1 || type > 6) return '—';
  return `Type ${SKIN_TYPE_ROMAN[type - 1]}`;
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { entries } = useScanHistory();
  const theme = useTheme();
  const navigation = useNavigation();
  const [signingOut, setSigningOut] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Tapping the Profile tab icon while already on this screen toggles the stats card.
  // `tabPress` isn't in expo-router's typed navigation event map, hence the cast.
  useEffect(() => {
    const unsubscribe = (navigation as unknown as { addListener: (event: 'tabPress', cb: () => void) => () => void }).addListener(
      'tabPress',
      () => {
        if (navigation.isFocused()) {
          setShowStats((s) => !s);
        }
      },
    );
    return unsubscribe;
  }, [navigation]);

  const name = user?.full_name?.trim() || 'Your profile';
  const identifier = user?.email || user?.phone || '';

  const age = computeAge(user?.date_of_birth ?? null);
  const sexLabel = user?.sex ? (SEX_LABELS[user.sex] ?? user.sex) : null;
  const skinLabel = skinTypeLabel(user?.fitzpatrick_skin_type ?? null);
  const missingDetails = age == null || !sexLabel || user?.fitzpatrick_skin_type == null;

  const scanCount = entries.length;
  const lastScan = entries[0]?.createdAt;
  const lastScanLabel = lastScan
    ? new Date(lastScan).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace('/(auth)/login');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="largeTitle">Profile</ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.push('/profile/edit')}
          accessibilityRole="button"
          style={({ pressed }) => pressed && styles.pressed}>
          <Card style={styles.identity}>
            <IconCircle icon="person.fill" variant="gradient" size={60} />
            <View style={styles.identityText}>
              <ThemedText type="headline">{name}</ThemedText>
              {identifier ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {identifier}
                </ThemedText>
              ) : null}
            </View>
            <Icon name="chevron.right" tintColor={theme.muted} size={18} />
          </Card>
        </Pressable>

        {showStats ? (
          <Card style={styles.statsCard}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Age
                </ThemedText>
                <ThemedText type="headline">{age != null ? age : '—'}</ThemedText>
              </View>
              <View style={[styles.statDivider, { backgroundColor: theme.hairline }]} />
              <View style={styles.statItem}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Sex
                </ThemedText>
                <ThemedText type="headline">{sexLabel ?? '—'}</ThemedText>
              </View>
              <View style={[styles.statDivider, { backgroundColor: theme.hairline }]} />
              <View style={styles.statItem}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Skin type
                </ThemedText>
                <ThemedText type="headline">{skinLabel}</ThemedText>
              </View>
            </View>
            {missingDetails ? (
              <Pressable
                onPress={() => router.push('/profile/edit')}
                accessibilityRole="button"
                style={styles.addDetails}>
                <ThemedText type="footnote" themeColor="brand">
                  Add details
                </ThemedText>
                <Icon name="chevron.right" tintColor={theme.brand} size={14} />
              </Pressable>
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.row}>
          <IconCircle icon="sparkles" variant="tint" size={48} />
          <View style={styles.rowText}>
            <ThemedText type="headline">
              {scanCount === 0
                ? 'No screenings yet'
                : `${scanCount} ${scanCount === 1 ? 'screening' : 'screenings'} completed`}
            </ThemedText>
            {lastScanLabel ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Last screening {lastScanLabel}
              </ThemedText>
            ) : null}
          </View>
        </Card>

        <Pressable
          onPress={() => router.push('/scan/history')}
          accessibilityRole="button"
          style={({ pressed }) => pressed && styles.pressed}>
          <Card style={styles.row}>
            <IconCircle icon="figure.stand" variant="tint" size={48} />
            <View style={styles.rowText}>
              <ThemedText type="headline">See body lesions</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                View your screening history on the 3D body
              </ThemedText>
            </View>
            <Icon name="chevron.right" tintColor={theme.muted} size={18} />
          </Card>
        </Pressable>

        <Card style={styles.section}>
          <SettingsRow icon="gearshape.fill" label="Settings" onPress={() => router.push('/profile/settings')} />
        </Card>

        <View style={styles.actions}>
          <Button label="Sign out" variant="outline" loading={signingOut} onPress={handleSignOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.lg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: Space.base },
  identity: { marginTop: Space.xl, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  identityText: { flex: 1, gap: 2 },
  statsCard: { marginTop: Space.base },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', gap: Space.xs },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  addDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    marginTop: Space.base,
  },
  row: { marginTop: Space.base, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  rowText: { flex: 1, gap: 2 },
  section: { marginTop: Space.base, gap: 0 },
  pressed: { opacity: 0.7 },
  actions: { marginTop: Space.xl },
});
