import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LesionRow } from '@/components/scan/lesion-row';
import { ScreeningRow } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';

type Tab = 'lesions' | 'scans';

/**
 * History, two ways. "Spots" (the default) groups by tracked lesion so repeat checks of one mole
 * read as one thing with a history; "All scans" keeps the flat chronological list unchanged.
 */
export default function AllScreeningsScreen() {
  const insets = useSafeAreaInsets();
  const { entries, lesions, loading, loadError, screeningsForLesion } = useScanHistory();
  // Seeded from the route once, then left alone: Home's two "See all" links open the tab that
  // matches the section they sit beside. Syncing this in an effect instead would fight the user's
  // own taps on the Segmented (and trip the React Compiler's cascading-render rule).
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === 'scans' ? 'scans' : 'lesions');

  // Archived lesions drop off the list but are never deleted — the scans still exist under "All scans".
  const visible = useMemo(() => lesions.filter((l) => !l.archived), [lesions]);

  const empty = tab === 'lesions' ? visible.length === 0 : entries.length === 0;
  // Three states, not two. A failed read used to fall through to "you don't have any screenings
  // yet" — telling a user their history is gone when it is merely unread.
  const emptyCopy = loading
    ? 'Loading your screenings…'
    : loadError
      ? 'We couldn’t open your saved screenings. They are still on this device — close the app and open it again.'
      : tab === 'lesions'
        ? 'No tracked spots yet. Every scan you take starts tracking the spot it was taken of.'
        : 'You don’t have any screenings yet.';

  return (
    <Screen padded={false} edges={['top']}>
      <Header />
      <View style={styles.segmentWrap}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'lesions', label: 'Spots' },
            { value: 'scans', label: 'All scans' },
          ]}
        />
      </View>

      {empty ? (
        <View style={styles.emptyBody}>
          <ThemedText type="body" themeColor="muted" style={styles.center}>
            {emptyCopy}
          </ThemedText>
        </View>
      ) : tab === 'lesions' ? (
        <FlatList
          data={visible}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <LesionRow lesion={item} screenings={screeningsForLesion(item.id)} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Space.xl }]}
          ItemSeparatorComponent={Separator}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <ThemedText type="footnote" themeColor="muted" style={styles.count}>
              {visible.length} {visible.length === 1 ? 'spot tracked' : 'spots tracked'}
            </ThemedText>
          }
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ScreeningRow item={item} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Space.xl }]}
          ItemSeparatorComponent={Separator}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <ThemedText type="footnote" themeColor="muted" style={styles.count}>
              {entries.length} {entries.length === 1 ? 'screening' : 'screenings'}
            </ThemedText>
          }
        />
      )}
    </Screen>
  );
}

function Header() {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Pressable
        hitSlop={12}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
        accessibilityRole="button"
        accessibilityLabel="Back">
        <Icon name="chevron.left" tintColor={theme.brand} size={20} />
      </Pressable>
      <ThemedText type="headline" themeColor="textSecondary">
        Your screenings
      </ThemedText>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  segmentWrap: { paddingHorizontal: Space.xl, paddingBottom: Space.base },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xl },
  center: { textAlign: 'center' },
  listContent: { paddingHorizontal: Space.xl, paddingTop: Space.sm },
  count: { marginBottom: Space.md },
  separator: { height: Space.md },
});
