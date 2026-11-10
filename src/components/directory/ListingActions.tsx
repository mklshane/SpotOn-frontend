import { t, useLocale } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { isSaved, toggleSaved, type SavedKind } from '@/data/saved-repo';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shareListing, type ShareListing } from '@/lib/share-listing';

/**
 * Save + Share for a clinic or doctor page header. `onDark` styles the buttons for the photo hero.
 * Saving needs a signed-in account (saved items are per account); the button hides otherwise.
 */
export function ListingActions({
  kind,
  itemId,
  name,
  subtitle,
  share,
  onDark = false,
}: {
  kind: SavedKind;
  itemId: string;
  name: string;
  subtitle?: string | null;
  share: ShareListing;
  onDark?: boolean;
}) {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    isSaved(kind, itemId, userId)
      .then((v) => !cancelled && setSaved(v))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, itemId, userId]);

  const onSave = useCallback(async () => {
    try {
      const next = await toggleSaved({ kind, itemId, name, subtitle }, userId);
      setSaved(next);
      setNote(next ? t('Saved to My dermatologists') : t('Removed from My dermatologists'));
    } catch {
      setNote(t("Couldn't save. Try again."));
    }
  }, [kind, itemId, name, subtitle, userId]);

  const onShare = useCallback(async () => {
    const outcome = await shareListing(share);
    if (outcome === 'copied') setNote(t('Details copied - paste them into a message.'));
    else if (outcome === 'failed') setNote(t("Couldn't open sharing on this device."));
  }, [share]);

  // The note is a short confirmation, not a persistent banner.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(id);
  }, [note]);

  const fg = onDark ? '#FFFFFF' : theme.brand;
  const bg = onDark ? 'rgba(0,0,0,0.4)' : 'transparent';

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {user ? (
          <Pressable
            onPress={onSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saved ? t('Remove from My dermatologists') : t('Save to My dermatologists')}
            accessibilityState={{ selected: saved }}
            style={[styles.btn, { backgroundColor: bg }]}
          >
            <Icon name={saved ? 'bookmark.fill' : 'bookmark'} size={20} tintColor={fg} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onShare}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Share')}
          accessibilityHint={t('Send the address, phone and schedule to someone')}
          style={[styles.btn, { backgroundColor: bg }]}
        >
          <Icon name="square.and.arrow.up" size={20} tintColor={fg} />
        </Pressable>
      </View>
      <Modal visible={!!note} transparent animationType="fade" onRequestClose={() => setNote(null)}>
        <View pointerEvents="box-none" style={[styles.noticeLayer, { paddingBottom: insets.bottom + Space.xl }]}>
          <View style={[styles.note, { backgroundColor: theme.text }]} accessibilityLiveRegion="polite">
            <ThemedText type="subhead" style={[styles.noteText, { color: theme.background }]}>
              {note}
            </ThemedText>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end' },
  row: { flexDirection: 'row', gap: Space.xs },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  noticeLayer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Space.xl,
  },
  note: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.pill,
    maxWidth: '100%',
  },
  noteText: { textAlign: 'center' },
});
