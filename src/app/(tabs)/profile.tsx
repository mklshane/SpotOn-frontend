import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { SettingsRow } from '@/components/ui/settings-row';
import { Gradients, Radius, Space } from '@/constants/theme';
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
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.full_name?.trim() || 'Your profile';
  const identifier = user?.email || user?.phone || '';

  const age = computeAge(user?.date_of_birth ?? null);
  const sexLabel = user?.sex ? (SEX_LABELS[user.sex] ?? user.sex) : null;
  const skinLabel = skinTypeLabel(user?.fitzpatrick_skin_type ?? null);

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
    <Screen padded={false} edges={['bottom']}>
      <View style={styles.hero}>
        <LinearGradient
          colors={Gradients.sunsetVivid.colors as unknown as [string, string, ...string[]]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ paddingTop: insets.top + Space.md }}>
          <ThemedText type="title2" themeColor="onBrand" style={styles.heroTitle}>
            Profile
          </ThemedText>

          <Pressable
            onPress={() => router.push('/profile/edit')}
            accessibilityRole="button"
            style={styles.avatarWrap}>
            <View style={styles.avatarFrost}>
              <Icon name="person.fill" tintColor="#FFFFFF" size={40} />
            </View>
            <View style={[styles.editBadge, { backgroundColor: theme.surface }]}>
              <Icon name="pencil" tintColor={theme.brand} size={13} />
            </View>
          </Pressable>

          <ThemedText type="title2" themeColor="onBrand" style={styles.heroName}>
            {name}
          </ThemedText>
          {identifier ? (
            <ThemedText type="footnote" style={[styles.heroIdentifier, { color: 'rgba(255,255,255,0.8)' }]}>
              {identifier}
            </ThemedText>
          ) : null}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                AGE
              </ThemedText>
              <ThemedText type="headline" themeColor="onBrand">
                {age != null ? age : '—'}
              </ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                SEX
              </ThemedText>
              <ThemedText type="headline" themeColor="onBrand">
                {sexLabel ?? '—'}
              </ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText type="caption" style={styles.statLabel}>
                SKIN TYPE
              </ThemedText>
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
          showsVerticalScrollIndicator={false}>
          <ThemedText type="caption" themeColor="brand" style={styles.sectionLabel}>
            ACTIVITY
          </ThemedText>
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

          <Card style={styles.menu}>
            <SettingsRow
              icon="figure.stand"
              label="See body lesions"
              sublabel="View your screening history on the 3D body"
              onPress={() => router.push('/scan/history')}
            />
          </Card>

          <Card style={styles.menu}>
            <SettingsRow
              icon="gearshape.fill"
              label="Settings"
              onPress={() => router.push('/profile/settings')}
            />
          </Card>

          <View style={styles.actions}>
            <Button label="Sign out" variant="outline" loading={signingOut} onPress={handleSignOut} />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

const AVATAR = 88;
const EDIT_BADGE = 30;

const styles = StyleSheet.create({
  hero: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  heroTitle: { opacity: 0.85, marginBottom: Space.lg },
  avatarWrap: { alignSelf: 'center', marginBottom: Space.base },
  avatarFrost: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  editBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: EDIT_BADGE,
    height: EDIT_BADGE,
    borderRadius: EDIT_BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7A2E08',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  heroName: { textAlign: 'center' },
  heroIdentifier: { textAlign: 'center', marginTop: 2 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: Space.xl },
  statItem: { flex: 1, alignItems: 'center', gap: Space.xs },
  statLabel: { color: 'rgba(255,255,255,0.75)', letterSpacing: 0.5 },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.3)' },
  sheet: { flex: 1, marginTop: -Radius.xl, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Space.xl, paddingTop: Space.xl, paddingBottom: Space.base },
  sectionLabel: { fontWeight: '700', letterSpacing: 0.6, marginBottom: Space.base },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base },
  rowText: { flex: 1, gap: 2 },
  menu: { marginTop: Space.base, gap: 0, paddingVertical: Space.md },
  actions: { marginTop: Space.xl },
});
