import { StyleSheet, View, type ViewProps } from 'react-native';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CardProps = ViewProps & {
  elevation?: keyof typeof Elevation;
  padded?: boolean;
};

export function Card({ style, elevation = 'sm', padded = true, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: theme.surface },
        padded && styles.padded,
        Elevation[elevation],
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radius.xl },
  padded: { padding: Space.xl },
});
