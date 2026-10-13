import { t, useLocale } from '@/lib/i18n';
import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ActionSheetOption = {
  key: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
};

export type ActionSheetProps = {
  visible: boolean;
  title?: string;
  options: ActionSheetOption[];
  onClose: () => void;
};

/**
 * Themed bottom action sheet (e.g. "Choose image source"). Mirrors the Modal +
 * backdrop pattern used by `DateField`. Tapping an option closes the sheet, then fires its handler.
 *
 * On iOS the handler waits for the Modal's `onDismiss`: presenting a native controller (e.g. the
 * photo library picker) while this Modal is still fading out fails silently - the picker never opens.
 */
export function ActionSheet({ visible, title, options, onClose }: ActionSheetProps) {
  useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pending = useRef<(() => void) | null>(null);

  function runPending() {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={runPending}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop propagation so taps inside the sheet don't dismiss it. */}
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + Space.base }]}>
          <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />

          {title ? (
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.title}>
              {title}
            </ThemedText>
          ) : null}

          <View style={styles.options}>
            {options.map((opt) => (
              <Pressable
                key={opt.key}
                accessibilityRole="button"
                onPress={() => {
                  pending.current = opt.onPress;
                  onClose();
                  // onDismiss is iOS-only; elsewhere there is no presentation conflict to wait out.
                  if (Platform.OS !== 'ios') runPending();
                }}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.elementBg },
                  pressed && styles.pressed,
                ]}>
                {opt.icon ? (
                  <Icon
                    name={opt.icon}
                    size={20}
                    tintColor={opt.destructive ? theme.riskCritical : theme.brand}
                  />
                ) : null}
                <ThemedText
                  type="headline"
                  themeColor={opt.destructive ? 'riskCritical' : 'text'}>
                  {opt.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
            <ThemedText type="headline" themeColor="textSecondary">
              {t("Cancel")}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(33,26,21,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.base,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  title: { textAlign: 'center', marginTop: Space.xs },
  options: { gap: Space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    height: 58,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
  },
  cancel: { height: 54, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
