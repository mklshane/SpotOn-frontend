import { Image } from 'expo-image';
import { Pressable, StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type LearnRecommendationCardProps = {
  image: ImageSourcePropType;
  title: string;
  summary: string;
  onPress: () => void;
};

/** Photo-led daily recommendation that opens an existing Learn article. */
export function LearnRecommendationCard({ image, title, summary, onPress }: LearnRecommendationCardProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Today's skin tip: ${title}. ${summary}`}
      accessibilityHint="Opens the related education article"
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <Card
        padded={false}
        style={[styles.card, { borderColor: theme.hairline }, compact && styles.cardCompact]}>
        <Image
          source={image}
          contentFit="cover"
          transition={180}
          accessible={false}
          style={[styles.image, compact && styles.imageCompact]}
        />

        <View style={styles.content}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.eyebrow}>
            TODAY&apos;S SKIN TIP
          </ThemedText>
          <ThemedText type="headline" numberOfLines={3}>
            {title}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={compact ? 3 : 4}>
            {summary}
          </ThemedText>
          <View style={styles.action}>
            <ThemedText type="subhead" style={styles.actionLabel}>
              Read UV guide
            </ThemedText>
            <Icon name="chevron.right" size={13} tintColor={theme.brandPressed} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: Radius.xl },
  pressed: { opacity: 0.72 },
  card: {
    minHeight: 164,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardCompact: { flexDirection: 'column' },
  image: { width: 132, alignSelf: 'stretch', backgroundColor: '#EEDCCF' },
  imageCompact: { width: '100%', height: 132 },
  content: { flex: 1, minWidth: 0, padding: Space.base, gap: Space.xs },
  eyebrow: { fontWeight: '700', letterSpacing: 0.55 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 'auto', minHeight: 20 },
  actionLabel: { fontWeight: '600' },
});
