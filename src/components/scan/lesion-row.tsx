import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Lesion, ScreeningRecord } from '@/lib/triage/types';

/**
 * A lesion with no nickname reads as its body region — never store this, derive it at display.
 *
 * The last fallback is "Unnamed", not "Untracked": every lesion on these surfaces IS tracked
 * (untracked ones are archived and filtered out), and `archived` renders its own "not tracked"
 * meta. Naming them "Untracked spot" contradicted both — on the detail screen it sat directly
 * under a "Tracked spot" header, and in the list it read as a whole column of untracked spots.
 */
export function lesionTitle(lesion: Lesion): string {
  if (lesion.label?.trim()) return lesion.label.trim();
  return lesion.mark?.region ? `${lesion.mark.region} spot` : 'Unnamed spot';
}

/** Exported so Home's spot carousel phrases "4 days ago" identically instead of drifting. */
export function relativeDate(iso: string | null): string {
  if (!iso) return 'Not scanned yet';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * One tracked lesion as a tappable card: latest photo (badged with the scan count), nickname,
 * when it was last checked, and its latest tier.
 *
 * The trend chevron is the point of the row — a lesion that went Moderate → High is a different
 * situation from one that has been Moderate all along, and that difference is what tracking buys.
 */
export function LesionRow({ lesion, screenings }: { lesion: Lesion; screenings: ScreeningRecord[] }) {
  const theme = useTheme();
  const title = lesionTitle(lesion);
  const latest = screenings.length ? screenings[screenings.length - 1] : undefined;
  const previous = screenings.length > 1 ? screenings[screenings.length - 2] : undefined;
  const tier = lesion.lastTier ?? latest?.triage.tier ?? 'low';
  const { fg, bg } = tierColor(theme, tier);
  const count = lesion.screeningCount || screenings.length;

  const order = ['low', 'moderate', 'high', 'critical'];
  const delta = previous && latest ? order.indexOf(latest.triage.tier) - order.indexOf(previous.triage.tier) : 0;
  const trend =
    !previous || delta === 0
      ? null
      : delta > 0
        ? { icon: 'arrow.up.right' as const, color: theme.riskHigh, label: 'more urgent than last time' }
        : { icon: 'arrow.down.right' as const, color: theme.riskLow, label: 'less urgent than last time' };

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scan/lesion', params: { id: lesion.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} ${count === 1 ? 'scan' : 'scans'}, last checked ${relativeDate(
        lesion.lastScreenedAt,
      )}${trend ? `, ${trend.label}` : ''}`}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card padded={false} style={[styles.row, lesion.archived && styles.archived]}>
        <View>
          {latest?.imageUri ? (
            <Image source={{ uri: latest.imageUri }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, { backgroundColor: theme.elementBg }]} />
          )}
          {count > 1 ? (
            <View style={[styles.countBadge, { backgroundColor: theme.text }]}>
              <ThemedText type="caption" style={styles.countText}>
                ×{count}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={styles.text}>
          <View style={styles.titleRow}>
            <View style={[styles.tierDot, { backgroundColor: fg }]} />
            <ThemedText type="headline" numberOfLines={1} style={styles.titleText}>
              {title}
            </ThemedText>
            {trend ? <Icon name={trend.icon} tintColor={trend.color} size={14} /> : null}
          </View>
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {relativeDate(lesion.lastScreenedAt)} · {count} {count === 1 ? 'scan' : 'scans'}
          </ThemedText>
        </View>

        <View style={[styles.tierPill, { backgroundColor: bg }]}>
          <ThemedText type="caption" style={{ color: fg }}>
            {tier === 'low' ? 'Low' : tier === 'moderate' ? 'Moderate' : tier === 'high' ? 'High' : 'Priority'}
          </ThemedText>
        </View>
        <Icon name="chevron.right" tintColor={theme.muted} size={16} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  archived: { opacity: 0.55 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.base, padding: Space.md },
  thumb: { width: 56, height: 56, borderRadius: Radius.md },
  countBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 22,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
  },
  countText: { color: '#FFFFFF' },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  titleText: { flexShrink: 1 },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierPill: { paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.pill },
});
