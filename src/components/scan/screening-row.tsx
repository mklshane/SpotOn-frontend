import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CLASS_DISPLAY } from '@/lib/triage/recommendations';
import type { ScreeningRecord, TriageTier } from '@/lib/triage/types';

/** Map a triage tier to its foreground/background risk colors (mirrors the result screen). */
export function tierColor(theme: ReturnType<typeof useTheme>, tier: TriageTier) {
  switch (tier) {
    case 'low':
      return { fg: theme.riskLow, bg: theme.riskLowBg };
    case 'moderate':
      return { fg: theme.riskModerate, bg: theme.riskModerateBg };
    case 'high':
      return { fg: theme.riskHigh, bg: theme.riskHighBg };
    default:
      return { fg: theme.riskCritical, bg: theme.riskCriticalBg };
  }
}

/**
 * One screening as a tappable card: photo thumbnail, classified type + confidence, date,
 * tier dot + pill, chevron. Used on Home (recent) and the full "All screenings" list.
 */
export function ScreeningRow({ item }: { item: ScreeningRecord }) {
  const theme = useTheme();
  const { fg, bg } = tierColor(theme, item.triage.tier);
  const cls = CLASS_DISPLAY[item.classification.topClass];
  const pct = Math.round(item.classification.topConfidence * 100);
  const date = new Date(item.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scan/result', params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${cls.full} screening from ${date}`}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card padded={false} style={styles.row}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: theme.elementBg }]} />
        )}
        <View style={styles.rowText}>
          <View style={styles.rowTitle}>
            <View style={[styles.tierDot, { backgroundColor: fg }]} />
            <ThemedText type="headline" numberOfLines={1} style={styles.rowTitleText}>
              {cls.full}
            </ThemedText>
          </View>
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {pct}% confidence · {date}
          </ThemedText>
        </View>
        <View style={[styles.tierPill, { backgroundColor: bg }]}>
          <ThemedText type="caption" style={{ color: fg }}>
            {pct}%
          </ThemedText>
        </View>
        <Icon name="chevron.right" tintColor={theme.muted} size={16} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    padding: Space.md,
  },
  thumb: { width: 56, height: 56, borderRadius: Radius.md },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowTitleText: { flex: 1 },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierPill: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill },
});
