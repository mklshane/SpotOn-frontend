import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Space } from '@/constants/theme';

import { Icon } from './icon';
import { StatusBar } from 'expo-status-bar';

export type ImageViewerProps = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
};

/**
 * Full-screen photo viewer. The scanned lesion image is shown `contain`-fit on a near-black
 * field so it reads clearly. Tapping the X (top-right, safe-area aware) or the backdrop closes it.
 * Mirrors the Modal + backdrop pattern used by `ActionSheet`.
 */
export function ImageViewer({ visible, uri, onClose }: ImageViewerProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Dark glyphs are unreadable over this near-black backdrop — see the note in capture.tsx. */}
      <StatusBar style="light" />
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close photo">
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : null}
        <View style={[styles.closeWrap, { top: insets.top + Space.sm }]} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
            <Icon name="xmark" tintColor="#FFFFFF" size={20} weight="semibold" />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  closeWrap: { position: 'absolute', right: Space.lg },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pressed: { opacity: 0.6 },
});
