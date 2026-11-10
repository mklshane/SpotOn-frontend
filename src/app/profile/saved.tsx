import { t, useLocale } from '@/lib/i18n';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { DocumentHeader } from '@/components/ui/document-header';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { isDatabaseEphemeral } from '@/data/db';
import { listSaved, removeSaved, type SavedItem } from '@/data/saved-repo';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

/** "My dermatologists": the clinics and doctors this account saved on this device. */
export default function SavedScreen() {
  useLocale();
  const theme = useTheme();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    listSaved(userId)
      .then((rows) => {
        setError(false);
        setItems(rows);
      })
      .catch(() => setError(true));
  }, [userId]);

  // Re-read on focus: saving happens on the detail pages, which sit on top of this screen.
  useFocusEffect(load);

  const open = (item: SavedItem) =>
    router.push({
      pathname: item.kind === 'facility' ? '/directory/clinic' : '/directory/doctor',
      params: { id: item.itemId },
    });

  const remove = async (item: SavedItem) => {
    try {
      await removeSaved(item.kind, item.itemId, userId);
      load();
    } catch {
      setError(true);
    }
  };

  return (
    <Screen padded={false}>
      <DocumentHeader title={t('My dermatologists')} />
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => `${i.kind}:${i.itemId}`}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          isDatabaseEphemeral() ? (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
              {t("This browser can't keep saved items after you close it. Use the SpotOn app to keep them.")}
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <Card style={styles.row} elevation="sm">
            <Pressable
              style={styles.main}
              onPress={() => (item.listed ? open(item) : undefined)}
              disabled={!item.listed}
              accessibilityRole="button"
              accessibilityLabel={[item.name, item.subtitle, item.listed ? null : t('No longer listed')]
                .filter(Boolean)
                .join(', ')}
            >
              <IconCircle icon={item.kind === 'facility' ? 'building.2.fill' : 'stethoscope'} size={40} variant="tint" />
              <View style={styles.text}>
                <ThemedText type="headline" numberOfLines={2}>
                  {item.name}
                </ThemedText>
                {item.subtitle ? (
                  <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                    {item.subtitle}
                  </ThemedText>
                ) : null}
                {!item.listed ? (
                  <ThemedText type="caption" themeColor="muted">
                    {t('No longer listed in the directory')}
                  </ThemedText>
                ) : null}
              </View>
              {item.listed ? <Icon name="chevron.right" size={14} tintColor={theme.textSecondary} /> : null}
            </Pressable>
            <Pressable
              onPress={() => remove(item)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Remove {{name}}', { name: item.name })}
              style={styles.remove}
            >
              <Icon name="bookmark.fill" size={18} tintColor={theme.brand} />
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={
          error ? (
            <ListState kind="error" title={t("Couldn't load your saved list")} action={{ label: t('Try again'), onPress: load }} />
          ) : items === null ? (
            <ListState kind="loading" title={t('Loading…')} />
          ) : (
            <ListState
              kind="empty"
              icon="bookmark"
              title={t('Nothing saved yet')}
              subtitle={t('Tap the bookmark on a clinic or doctor to keep it here, even offline.')}
              action={{ label: t('Open the directory'), onPress: () => router.push('/(tabs)/directory') }}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  note: { marginBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  text: { flex: 1, gap: 2 },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
