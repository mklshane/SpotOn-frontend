import { StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';

export type StarRatingProps = {
  rating: number;
  reviewCount?: number | null;
  size?: number;
};

export function StarRating({ rating, reviewCount, size = 14 }: StarRatingProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Icon name="star.fill" size={size} tintColor={theme.riskModerate} />
      <ThemedText type="footnote" themeColor="text" style={styles.value}>
        {rating.toFixed(1)}
      </ThemedText>
      {reviewCount ? (
        <ThemedText type="footnote" themeColor="muted">
          ({reviewCount})
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  value: { fontWeight: '600' },
});
