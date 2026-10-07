import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { MAX_IMAGES_PER_SCREENING } from '@/lib/classifier/model-config';
import { t, useLocale } from '@/lib/i18n';
import { useScreeningSession } from '@/lib/screening-session';

/**
 * The photos already taken for this spot, as a tappable chip above the shutter.
 *
 * "Add another photo" on the review screen pops back to the camera, so without a way back the only
 * exit would be taking another photo. This is that way back: the latest photo, the count, and a tap
 * returns to the review screen with the set intact. Hidden until there is at least one photo.
 */
export function ReviewChip({ style }: { style?: object }) {
  useLocale();
  const { images } = useScreeningSession();
  if (images.length === 0) return null;
  const last = images[images.length - 1];
  return (
    <Animated.View entering={ZoomIn.springify().damping(14)} style={style}>
      <Pressable
        hitSlop={8}
        onPress={() => router.push('/scan/review')}
        style={styles.chip}
        accessibilityRole="button"
        accessibilityLabel={t('Review photos, {{n}} of {{total}}', { n: images.length, total: MAX_IMAGES_PER_SCREENING })}>
        <View style={styles.thumb}>
          <Image source={{ uri: last.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        </View>
        <ThemedText type="caption" style={styles.text}>
          {t('{{n}} of {{total}}', { n: images.length, total: MAX_IMAGES_PER_SCREENING })}
        </ThemedText>
        <Icon name="chevron.right" tintColor="rgba(255,255,255,0.8)" size={12} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.xs,
    paddingRight: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(20,16,13,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  thumb: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  text: { color: '#FFFFFF' },
});
