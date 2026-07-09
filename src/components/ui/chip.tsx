import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ChipProps = {
  label: string;
  active?: boolean;
  icon?: IconName;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

/** Toggleable filter chip. Active = brandTint fill + brand text; inactive = elementBg + textSecondary. */
export function Chip({ label, active = false, icon, onPress, style }: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.brandTint : theme.elementBg }, style]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      {icon ? (
        <Icon name={icon} size={14} tintColor={active ? theme.brand : theme.textSecondary} style={styles.icon} />
      ) : null}
      <ThemedText type="subhead" themeColor={active ? 'brand' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  icon: { marginRight: Space.xs },
});
