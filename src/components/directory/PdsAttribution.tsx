import { t, useLocale } from '@/lib/i18n';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openWebsite, PDS_DIRECTORY_URL } from '@/lib/links';

/**
 * Source credit and disclaimer for the dermatologist listings. The PDS Board approved our use of
 * its public "Find a Dermatologist" directory (2026-10-16) on condition that PDS is acknowledged,
 * so every directory list and detail page carries this line.
 */
export function PdsAttribution({ style }: { style?: object }) {
  useLocale();
  const theme = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <ThemedText type="caption" themeColor="textSecondary">
        {t('Dermatologists are listed from the Philippine Dermatological Society (PDS) Find a Dermatologist directory, used with permission. A listing is not an endorsement - call ahead to confirm schedules.')}
      </ThemedText>
      <Pressable
        onPress={() => openWebsite(PDS_DIRECTORY_URL)}
        accessibilityRole="link"
        accessibilityHint={t('Opens the PDS directory in your browser')}
        hitSlop={8}
      >
        <ThemedText type="caption" style={[styles.link, { color: theme.brandPressed }]}>
          {t('View the PDS directory')}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.xs, paddingVertical: Space.base },
  link: { fontWeight: '600' },
});
