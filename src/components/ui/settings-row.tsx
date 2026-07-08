import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';
import { IconCircle } from './icon-circle';
import { Switch } from './switch';

export type SettingsRowProps = {
  icon: IconName;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  /**
   * `'chevron'` (default) shows a nav arrow. `'switch'` renders a `Switch` wired
   * to `switchValue`/`onSwitchChange` and the row's own `onPress` is ignored (no
   * nested-touchable conflict). Any other `ReactNode` (including `null` for a
   * plain informational row) is rendered as-is — an interactive `ReactNode`
   * accessory is the caller's responsibility to keep out of the row's own
   * touch target.
   */
  accessory?: 'chevron' | 'switch' | ReactNode;
  switchValue?: boolean;
  onSwitchChange?: (next: boolean) => void;
  /** Renders the label and icon tint in the critical/danger color (e.g. "Delete account"). */
  destructive?: boolean;
};

export function SettingsRow({
  icon,
  label,
  sublabel,
  onPress,
  accessory = 'chevron',
  switchValue = false,
  onSwitchChange,
  destructive = false,
}: SettingsRowProps) {
  const theme = useTheme();

  let accessoryNode: ReactNode;
  if (accessory === 'chevron') {
    accessoryNode = <Icon name="chevron.right" tintColor={theme.muted} size={18} />;
  } else if (accessory === 'switch') {
    accessoryNode = <Switch value={switchValue} onChange={(next) => onSwitchChange?.(next)} />;
  } else {
    accessoryNode = accessory;
  }

  const isInteractive = accessory !== 'switch' && Boolean(onPress);

  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      accessibilityRole={isInteractive ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && isInteractive && styles.pressed]}>
      <IconCircle
        icon={icon}
        variant="tint"
        size={44}
        iconColor={destructive ? theme.riskCritical : undefined}
        tintBg={destructive ? theme.riskCriticalBg : undefined}
      />
      <View style={styles.text}>
        <ThemedText type="headline" themeColor={destructive ? 'riskCritical' : 'text'}>
          {label}
        </ThemedText>
        {sublabel ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {sublabel}
          </ThemedText>
        ) : null}
      </View>
      {accessoryNode}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.base,
    paddingVertical: Space.md,
  },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
});
