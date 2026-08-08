import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { getClinicalImage, type ClinicalImageId } from '@/data/learn-images';
import { useTheme } from '@/hooks/use-theme';

export type ClinicalImageProps = {
  id: ClinicalImageId;
  /**
   * Drawing to show when the slot has no photograph. IGNORED for slots marked
   * `photoRequired`, which show a labelled gap instead. Pass one only where an
   * illustration genuinely explains the thing (a body location, a process),
   * never where the point is what a lesion looks like.
   */
  illustration?: ReactNode;
  /** Label under the frame, e.g. "Irregular border". */
  caption?: string;
  /** Draws the caption in the accent color, for the concerning half of a pair. */
  emphasis?: boolean;
  /** Documented size, quoted from the source. Rendered under the caption. */
  measurement?: string;
};

/**
 * One visual in an Education article.
 *
 * Renders a real clinical photograph when the slot has a cleared, licensed
 * asset. What it does when the slot is empty depends on the slot:
 *
 *  - `photoRequired` slots (every ABCDE sign, and each cancer type's "What it
 *    may look like") render a labelled gap. Recognising a lesion is the entire
 *    purpose of those frames, and a drawing cannot carry it.
 *  - Everything else may fall back to an illustration, which is the right tool
 *    for a concept, a process, or a location on the body.
 *
 * The frame is always labelled, so nobody has to guess whether they are looking
 * at evidence or at a diagram.
 */
export function ClinicalImage({
  id,
  illustration,
  caption,
  emphasis = false,
  measurement,
}: ClinicalImageProps) {
  const theme = useTheme();
  const spec = getClinicalImage(id);

  // The guard is here rather than at the call site so the rule holds even if
  // someone later passes an illustration into an ABCDE frame by habit.
  const mayIllustrate = Boolean(illustration) && !spec.photoRequired;

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.frame,
          { backgroundColor: theme.elementBg },
          !spec.asset && !mayIllustrate && [styles.gap, { borderColor: theme.hairline }],
        ]}>
        {spec.asset ? (
          <Image
            source={spec.asset}
            contentFit={spec.fit ?? 'cover'}
            transition={180}
            accessible
            accessibilityLabel={spec.alt}
            style={styles.photo}
          />
        ) : mayIllustrate ? (
          <View accessible accessibilityLabel={spec.alt} style={styles.fallback}>
            {illustration}
          </View>
        ) : (
          <PhotoNeeded needs={spec.needs} />
        )}

        {spec.asset || mayIllustrate ? (
          <View style={[styles.kind, { backgroundColor: theme.surface }]}>
            <ThemedText type="caption" themeColor="muted" style={styles.kindLabel}>
              {!spec.asset ? 'ILLUSTRATION' : spec.modality === 'dermoscopic' ? 'DERMOSCOPIC' : 'PHOTO'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {caption ? (
        <ThemedText
          type="caption"
          themeColor={emphasis ? undefined : 'muted'}
          style={[styles.caption, emphasis && { color: theme.brandPressed, fontWeight: '600' }]}>
          {caption}
        </ThemedText>
      ) : null}

      {measurement ? (
        <ThemedText type="subhead" style={[styles.measurement, { color: theme.text }]}>
          {measurement}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * The labelled gap. Deliberately plain and obviously unfinished: it must never
 * be mistakable for an example of anything. In development it also names what
 * the slot needs, so whoever sources the image does not have to go hunting.
 */
function PhotoNeeded({ needs }: { needs: string }) {
  const theme = useTheme();

  return (
    <View style={styles.needed} accessible accessibilityLabel="Clinical photograph not yet available">
      <Icon name="photo.on.rectangle" size={22} tintColor={theme.muted} />
      <ThemedText type="caption" themeColor="textSecondary" style={styles.neededLabel}>
        Clinical photo needed
      </ThemedText>
      {__DEV__ ? (
        <ThemedText type="caption" themeColor="muted" numberOfLines={4} style={styles.neededHint}>
          {needs}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: Space.sm },
  frame: {
    aspectRatio: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Dashed while the slot is empty, so an unfilled frame reads as unfinished
  // at a glance rather than as a deliberate blank image.
  gap: { borderWidth: 1, borderStyle: 'dashed' },
  photo: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },

  needed: { alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.sm },
  neededLabel: { fontWeight: '600', textAlign: 'center' },
  neededHint: { textAlign: 'center', fontSize: 10, lineHeight: 13 },

  kind: {
    position: 'absolute',
    top: Space.sm,
    left: Space.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    opacity: 0.9,
  },
  kindLabel: { fontSize: 9, lineHeight: 13, fontWeight: '700', letterSpacing: 0.5 },
  caption: { textAlign: 'center' },
  measurement: { textAlign: 'center', fontWeight: '700', marginTop: -2 },

});
