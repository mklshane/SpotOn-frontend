import { Image } from 'expo-image';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type EducationCardProps = {
  title: string;
  description?: string;
  /** Small uppercase eyebrow, e.g. "Sun Safety · 3 min read". */
  tag?: string;
  /** Thumbnail: a photo, or an icon rendered on a soft tinted tile. */
  image?: ImageSourcePropType;
  /** Alt text for `image`. Ignored for the icon thumbnail, which is decorative. */
  imageLabel?: string;
  icon?: IconName;
  onPress: () => void;
};

const THUMB = 64;

/**
 * The workhorse browse card — thumbnail left, three tight lines of text right.
 * Used for both the daily tip and the topic list so a scan down the page reads
 * as one rhythm instead of a stack of differently-shaped boxes.
 */
export function EducationCard({
  title,
  description,
  tag,
  image,
  imageLabel,
  icon,
  onPress,
}: EducationCardProps) {
  const theme = useTheme();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tag ? `${tag}. ${title}` : title}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }, Elevation.sm]}>
      {image ? (
        <Image
          source={image}
          contentFit="cover"
          transition={180}
          accessible={Boolean(imageLabel)}
          accessibilityLabel={imageLabel}
          style={styles.thumb}
        />
      ) : icon ? (
        <View style={[styles.thumb, styles.iconTile, { backgroundColor: theme.brandTint }]}>
          <Icon name={icon} size={26} tintColor={theme.brand} />
        </View>
      ) : null}

      <View style={styles.text}>
        {tag ? (
          <ThemedText type="caption" style={[styles.tag, { color: theme.brandPressed }]} numberOfLines={1}>
            {tag}
          </ThemedText>
        ) : null}
        <ThemedText type="headline" numberOfLines={2}>
          {title}
        </ThemedText>
        {description ? (
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
            {description}
          </ThemedText>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    padding: Space.base,
    borderRadius: Radius.lg,
    // Warm hairline, matching the rest of the app — iOS shadows alone are too
    // faint to separate a white card from the warm off-white page behind it.
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.md,
    backgroundColor: '#EEDCCF',
  },
  iconTile: { alignItems: 'center', justifyContent: 'center' },
  // minWidth: 0 lets long titles ellipsize instead of pushing the row wider
  // than the screen on 360px devices.
  text: { flex: 1, minWidth: 0, gap: 2 },
  tag: { fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
});
