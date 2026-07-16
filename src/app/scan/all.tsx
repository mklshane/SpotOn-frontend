import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreeningRow } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanHistory } from '@/lib/scan-history';

export default function AllScreeningsScreen() {
  const insets = useSafeAreaInsets();
  const { entries, loading } = useScanHistory();

  return (
    <Screen padded={false}>
      <Header />
      {entries.length === 0 ? (
        <View style={styles.emptyBody}>
          <ThemedText type="body" themeColor="muted" style={styles.center}>
            {loading ? 'Loading your screenings…' : 'You don’t have any screenings yet.'}
          </ThemedText>
        </View>
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
        All screenings
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
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xl },
  center: { textAlign: 'center' },
  listContent: { paddingHorizontal: Space.xl, paddingTop: Space.sm },
  count: { marginBottom: Space.md },
  separator: { height: Space.md },
});
