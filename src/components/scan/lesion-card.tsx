import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BodyGlyph } from '@/components/scan/body-glyph';
import { BodySpotPreview } from '@/components/scan/body-spot-preview';
import { lesionTitle, relativeDate } from '@/components/scan/lesion-row';
import { tierColor } from '@/components/scan/screening-row';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TIER_CONTENT } from '@/lib/triage/recommendations';
import type { Lesion, ScreeningRecord } from '@/lib/triage/types';

const CARD_W = 148;

/**
 * One tracked lesion as a compact photo-led card, for Home's horizontal spot carousel.
 *
 * The vertical LesionRow already covers the Spots list; this is the same information at a
 * glanceable size, sharing that row's title and date helpers so the two surfaces can't drift
 * apart in wording. `latest` is passed in rather than looked up: Home resolves every card's photo
 * from one Map over the screening list, instead of each card filtering all of them.
 */
export function LesionCard({ lesion, latest }: { lesion: Lesion; latest?: ScreeningRecord }) {
  const theme = useTheme();
  const title = lesionTitle(lesion);
  const tier = lesion.lastTier ?? latest?.triage.tier ?? 'low';
  const { fg } = tierColor(theme, tier);
  const count = lesion.screeningCount || (latest ? 1 : 0);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scan/lesion', params: { id: lesion.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${TIER_CONTENT[tier].name}, ${count} ${
        count === 1 ? 'scan' : 'scans'
      }, last checked ${relativeDate(lesion.lastScreenedAt)}`}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card padded={false} style={styles.card}>
        <View style={[styles.artFrame, { backgroundColor: theme.elementBg }]}>
          {/* A marked spot gets the same 3D model the user just placed it on, cropped around the
              saved point. Unmarked legacy records keep the simple region illustration fallback. */}
          {lesion.mark ? (
            <BodySpotPreview mark={lesion.mark} />
          ) : (
            <BodyGlyph region={null} size={104} />
          )}
          {/* Tier as a solid pill rather than a bare dot - the same treatment the lesion
              timeline uses. */}
          <View style={[styles.tier, { backgroundColor: theme.surface }]}>
            <View style={[styles.tierDot, { backgroundColor: fg }]} />
            <ThemedText type="caption" style={{ color: fg }}>
              {TIER_CONTENT[tier].name}
            </ThemedText>
          </View>
        </View>

        <View style={styles.meta}>
          <ThemedText type="subhead" numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText type="caption" themeColor="muted" numberOfLines={1}>
            {relativeDate(lesion.lastScreenedAt)}
            {count > 1 ? ` · ×${count}` : ''}
          </ThemedText>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  card: { width: CARD_W, overflow: 'hidden' },
  artFrame: {
    width: CARD_W - Space.base,
    height: 132,
    marginTop: Space.sm,
    marginHorizontal: Space.sm,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  tier: {
    position: 'absolute',
    left: Space.sm,
    bottom: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
  meta: { paddingHorizontal: Space.md, paddingVertical: Space.md, gap: 2 },
});
