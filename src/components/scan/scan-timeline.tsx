import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreeningThumbnail } from '@/components/scan/screening-thumbnail';
import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ScreeningRecord, TriageTier } from '@/lib/triage/types';

const TIER_LABEL: Record<TriageTier, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Priority',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type ScanTimelineProps = {
  /** Oldest first. The last entry is treated as the latest scan. */
  screenings: ScreeningRecord[];
  onOpen: (screening: ScreeningRecord) => void;
};

/**
 * The scan history for one tracked spot.
 *
 * Two shapes, because one photo and six photos are different problems. A single
 * scan gets a full-width card: a lone 132pt thumbnail on an otherwise empty
 * screen reads as an uploaded picture rather than as the first entry in a
 * record. Two or more become a scrollable strip under a connecting rail, where
 * the comparison between photos is the whole point.
 */
export function ScanTimeline({ screenings, onOpen }: ScanTimelineProps) {
  if (screenings.length === 0) return null;
  if (screenings.length === 1) return <SoloScan screening={screenings[0]} onOpen={onOpen} />;
  return <ScanStrip screenings={screenings} onOpen={onOpen} />;
}

/** The first scan, given room so the record reads as started rather than sparse. */
function SoloScan({ screening, onOpen }: { screening: ScreeningRecord; onOpen: ScanTimelineProps['onOpen'] }) {
  const theme = useTheme();
  const c = tierColor(theme, screening.triage.tier);

  return (
    <PressableScale
      onPress={() => onOpen(screening)}
      accessibilityRole="button"
      accessibilityLabel={`First scan, ${fmtDate(screening.createdAt)}, ${TIER_LABEL[screening.triage.tier]}`}
      style={[styles.soloCard, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      <View style={styles.soloPhotoWrap}>
        <ScreeningThumbnail uri={screening.imageUri} style={styles.soloPhoto} iconSize={32} />
        <View style={[styles.tierPill, styles.soloTier, { backgroundColor: theme.surface }]}>
          <View style={[styles.tierDot, { backgroundColor: c.fg }]} />
          <ThemedText type="caption" style={{ color: c.fg }}>
            {TIER_LABEL[screening.triage.tier]}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.soloFooter, { borderTopColor: theme.hairline }]}>
        <ThemedText type="subhead">{fmtDate(screening.createdAt)}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.brand }}>
          Latest
        </ThemedText>
      </View>
    </PressableScale>
  );
}

/** Two or more scans, oldest to newest, under a continuous rail. */
function ScanStrip({ screenings, onOpen }: ScanTimelineProps) {
  const theme = useTheme();
  const last = screenings.length - 1;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {screenings.map((s, i) => {
        const c = tierColor(theme, s.triage.tier);
        const isLatest = i === last;

        return (
          <PressableScale
            key={s.id}
            onPress={() => onOpen(s)}
            accessibilityRole="button"
            accessibilityLabel={`Scan ${i + 1} of ${screenings.length}, ${fmtDate(s.createdAt)}, ${TIER_LABEL[s.triage.tier]}`}
            style={styles.stripItem}>
            {/* backgroundColor is load-bearing, not decoration: iOS derives the shadow
                path from the layer's backing, so a transparent wrapper casts nothing. */}
            <View style={[styles.stripPhotoWrap, { backgroundColor: theme.surface }]}>
              <ScreeningThumbnail uri={s.imageUri} style={styles.stripPhoto} iconSize={24} />
              <View style={[styles.tierPill, styles.stripTier, { backgroundColor: theme.surface }]}>
                <View style={[styles.tierDot, { backgroundColor: c.fg }]} />
                <ThemedText type="caption" style={{ color: c.fg }}>
                  {TIER_LABEL[s.triage.tier]}
                </ThemedText>
              </View>
            </View>

            {/* The rail. Segments bridge the gap between items so the line reads
                as continuous, and stop at the first and last dot rather than
                trailing off into space at either end. */}
            <View style={styles.rail}>
              {i > 0 ? <View style={[styles.railLine, styles.railLeft, { backgroundColor: theme.hairline }]} /> : null}
              {i < last ? (
                <View style={[styles.railLine, styles.railRight, { backgroundColor: theme.hairline }]} />
              ) : null}
              <View
                style={[
                  styles.railDot,
                  { backgroundColor: isLatest ? theme.brand : theme.hairline, borderColor: theme.background },
                ]}
              />
            </View>

            <View style={styles.stripMeta}>
              <ThemedText type="subhead" themeColor={isLatest ? 'text' : 'textSecondary'}>
                {fmtShort(s.createdAt)}
              </ThemedText>
              {isLatest ? (
                <ThemedText type="caption" style={{ color: theme.brand }}>
                  Latest
                </ThemedText>
              ) : i === 0 ? (
                <ThemedText type="caption" themeColor="muted">
                  First
                </ThemedText>
              ) : null}
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const ITEM = 132;
const GAP = Space.base;

const styles = StyleSheet.create({
  // Shared tier pill. A 10px dot alone floating on a photo disappears against a
  // light lesion and reads as an artifact, so it sits on a solid chip.
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    ...Elevation.sm,
  },
  tierDot: { width: 6, height: 6, borderRadius: 3 },

  soloCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...Elevation.sm,
  },
  soloPhotoWrap: { width: '100%' },
  // 4:3 rather than square: closer to how the capture screen frames a lesion,
  // so the stored photo is not cropped a second time on the way in.
  soloPhoto: { width: '100%', aspectRatio: 4 / 3 },
  soloTier: { position: 'absolute', left: Space.md, bottom: Space.md },
  soloFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.base,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  strip: { gap: GAP, paddingVertical: Space.xs, paddingRight: Space.xl },
  stripItem: { width: ITEM, alignItems: 'flex-start' },
  stripPhotoWrap: { ...Elevation.sm, borderRadius: Radius.lg },
  stripPhoto: { width: ITEM, height: ITEM, borderRadius: Radius.lg },
  stripTier: { position: 'absolute', left: Space.sm, bottom: Space.sm },

  rail: { width: ITEM, height: 20, alignItems: 'center', justifyContent: 'center' },
  railLine: { position: 'absolute', height: StyleSheet.hairlineWidth, top: 10 },
  railLeft: { left: -GAP, right: '50%' },
  railRight: { left: '50%', right: -GAP },
  railDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },

  stripMeta: { gap: 2 },
});
