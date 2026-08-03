import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';

import { CancerTypeArtwork, type CancerTypeKind } from '@/components/learn/CancerTypeCard';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PhotoVisual = {
  source: ImageSourcePropType;
  accessibilityLabel: string;
};

export type LearnArticleHeroProps = {
  articleId: string;
  icon: IconName;
  title: string;
  sectionCount: number;
};

const SELF_CHECK_IMAGE = require('@/assets/images/learn/article-self-check.jpg');
const SUN_PROTECTION_IMAGE = require('@/assets/images/learn/recommended-sun-protection.jpg');
const CONSULTATION_IMAGE = require('@/assets/images/learn/article-consultation.jpg');

const ARTICLE_PHOTOS: Record<string, PhotoVisual> = {
  'what-is-skin-cancer': {
    source: SELF_CHECK_IMAGE,
    accessibilityLabel: 'A woman performing a routine skin self-check on her forearm',
  },
  'warning-signs': {
    source: SELF_CHECK_IMAGE,
    accessibilityLabel: 'A woman carefully checking the skin on her forearm',
  },
  'risk-factors': {
    source: SUN_PROTECTION_IMAGE,
    accessibilityLabel: 'A woman applying sunscreen outdoors',
  },
  prevention: {
    source: SUN_PROTECTION_IMAGE,
    accessibilityLabel: 'A woman applying sunscreen outdoors',
  },
  'when-to-see-a-doctor': {
    source: CONSULTATION_IMAGE,
    accessibilityLabel: 'A dermatologist examining a patient\'s forearm',
  },
};

const CANCER_TYPE_VISUALS: Partial<Record<string, CancerTypeKind>> = {
  melanoma: 'melanoma',
  scc: 'scc',
  bcc: 'bcc',
};

/** Topic-specific visual header shared by all Learn article detail pages. */
export function LearnArticleHero({ articleId, icon, title, sectionCount }: LearnArticleHeroProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const photo = ARTICLE_PHOTOS[articleId];
  const cancerType = CANCER_TYPE_VISUALS[articleId];

  return (
    <Card padded={false} style={[styles.card, { borderColor: theme.hairline }]}>
      {photo ? (
        <Image
          source={photo.source}
          contentFit="cover"
          transition={180}
          accessible
          accessibilityLabel={photo.accessibilityLabel}
          style={[styles.photo, compact && styles.photoCompact]}
        />
      ) : (
        <View
          accessible={false}
          style={[
            styles.artwork,
            { backgroundColor: theme.brandTint },
            compact && styles.artworkCompact,
          ]}>
          {cancerType ? (
            <View
              style={[
                styles.artworkMedallion,
                { backgroundColor: theme.surface },
                compact && styles.artworkMedallionCompact,
              ]}>
              <CancerTypeArtwork kind={cancerType} size={compact ? 116 : 136} />
            </View>
          ) : (
            <Icon name={icon} size={56} tintColor={theme.brand} />
          )}
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.eyebrowRow}>
          <Icon name="book.fill" size={13} tintColor={theme.brandPressed} />
          <ThemedText type="caption" style={[styles.eyebrow, { color: theme.brandPressed }]}>
            EDUCATION GUIDE
          </ThemedText>
        </View>
        <ThemedText type={compact ? 'title2' : 'title1'}>{title}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  photo: { width: '100%', height: 188, backgroundColor: '#EEDCCF' },
  photoCompact: { height: 160 },
  artwork: { height: 188, alignItems: 'center', justifyContent: 'center' },
  artworkCompact: { height: 160 },
  artworkMedallion: {
    width: 156,
    height: 156,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkMedallionCompact: { width: 136, height: 136 },
  content: { padding: Space.lg, gap: Space.xs },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  eyebrow: { fontWeight: '700', letterSpacing: 0.55 },
});
