import { Icon } from '@/components/ui/icon';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CheckboxProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  children?: React.ReactNode;
};

export function Checkbox({ checked, onChange, children }: CheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.row}>
      <View
        style={[
          styles.box,
          checked
            ? { backgroundColor: theme.brand, borderColor: theme.brand }
            : { backgroundColor: 'transparent', borderColor: theme.hairline },
        ]}>
        {checked ? <Icon name="checkmark" tintColor={theme.onBrand} size={13} /> : null}
      </View>
      <View style={styles.label}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  box: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  label: { flex: 1 },
});
