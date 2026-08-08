import { Image } from 'expo-image';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type FeaturedEducationCardProps = {
  image: ImageSourcePropType;
  /** Alt text for the photo — describes the image, not the article. */
  imageLabel: string;
  /** Short category shown on the photo, e.g. "Warning Signs". */
  category: string;
  title: string;
  description: string;
  /** Quiet supporting line, e.g. "2 min read". */
  meta?: string;
  onPress: () => void;
};

/**
 * The one promoted guide at the top of the Learn hub: a full-width photo card
 * with the category floated on the image and the action pinned bottom-right.
 * Deliberately the only photo-led block above the fold so it reads as *the*
 * focal point rather than one of several banners.
 */
export function FeaturedEducationCard({
  image,
  imageLabel,
  category,
  title,
  description,
  meta,
  onPress,
}: FeaturedEducationCardProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 375;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category}: ${title}`}
      accessibilityHint="Opens the guide"
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
        <View>
          <Image
            source={image}
            contentFit="cover"
            transition={180}
            accessible
            accessibilityLabel={imageLabel}
            style={[styles.image, compact && styles.imageCompact]}
          />
          <View style={[styles.categoryPill, { backgroundColor: theme.surface }]}>
            <ThemedText type="caption" style={[styles.categoryLabel, { color: theme.brandPressed }]}>
              {category}
            </ThemedText>
          </View>
        </View>

        <View style={styles.content}>
          <ThemedText type="title2" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText type="callout" themeColor="textSecondary" numberOfLines={2}>
            {description}
          </ThemedText>

          <View style={styles.footer}>
            {meta ? (
              <View style={styles.meta}>
                <Icon name="clock.fill" size={12} tintColor={theme.muted} />
                <ThemedText type="caption" themeColor="muted">
                  {meta}
                </ThemedText>
              </View>
            ) : null}
            <View style={[styles.action, { backgroundColor: theme.brand }]}>
              <Icon name="chevron.right" size={15} tintColor={theme.onBrand} />
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: Radius.xl },
  pressed: { opacity: 0.85 },
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  image: { width: '100%', height: 172, backgroundColor: '#EEDCCF' },
  imageCompact: { height: 148 },
  categoryPill: {
    position: 'absolute',
    left: Space.base,
    bottom: Space.base,
    paddingHorizontal: Space.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    ...Elevation.sm,
  },
  categoryLabel: { fontWeight: '700', letterSpacing: 0.5 },
  content: { padding: Space.lg, gap: Space.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.xs,
    minHeight: 36,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  action: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
});
