import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Button } from './button';
import { IconCircle } from './icon-circle';
import type { IconName } from './icon';

export type ConfirmDialogProps = {
  visible: boolean;
  /** Soft tint circle above the title. Omit for a text-only dialog. */
  icon?: IconName;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Tints the icon circle and the confirm button for a consequential choice. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Centered confirmation dialog — the themed counterpart to `Alert.alert` for decisions that
 * deserve real estate and warm copy (e.g. skipping the questionnaire). Same Modal + backdrop
 * pattern as `ActionSheet`; tapping the backdrop cancels.
 */
export function ConfirmDialog({
  visible,
  icon,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Dismiss">
        {/* Stop propagation so taps inside the card don't dismiss it. */}
        <Animated.View entering={FadeIn.duration(160)} style={styles.cardWrap}>
          <Pressable style={[styles.card, { backgroundColor: theme.surface }, Elevation.lg]}>
            {icon ? (
              <IconCircle
                icon={icon}
                size={64}
                tintBg={destructive ? theme.riskHighBg : undefined}
                iconColor={destructive ? theme.riskHigh : undefined}
              />
            ) : null}

            <View style={styles.copy}>
              <ThemedText type="title2" style={styles.center}>
                {title}
              </ThemedText>
              <ThemedText type="callout" themeColor="textSecondary" style={styles.center}>
                {message}
              </ThemedText>
            </View>

            <View style={styles.actions}>
              <Button
                label={confirmLabel}
                variant="brand"
                onPress={onConfirm}
                style={styles.action}
              />
              <Button
                label={cancelLabel}
                variant="ghost"
                onPress={onCancel}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(33,26,21,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  cardWrap: { width: '100%', maxWidth: 400 },
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xl,
    paddingBottom: Space.base,
    alignItems: 'center',
    gap: Space.lg,
  },
  copy: { gap: Space.sm },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Space.xs },
  action: { alignSelf: 'stretch' },
});
