import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { BodyViewer } from '@/components/scan/body-viewer';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useScanDraft } from '@/lib/scan-draft';

export default function BodyAreaScreen() {
  const theme = useTheme();
  const { bodyMark, setBodyMark } = useScanDraft();
  const [sheetOpen, setSheetOpen] = useState(false);

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      // Hand off to the image-quality gate; it records the entry on pass / "use anyway".
      router.push({ pathname: '/scan/quality', params: { uri: result.assets[0].uri } });
    }
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Body area
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.viewer}>
        <BodyViewer mark={bodyMark} onPick={setBodyMark} />
      </View>

      <View style={styles.copy}>
        {bodyMark ? (
          <ThemedText type="title2" style={styles.center}>
            {bodyMark.region}
          </ThemedText>
        ) : (
          <ThemedText type="headline" themeColor="textSecondary" style={styles.center}>
            Mark the spot on the 3D model
          </ThemedText>
        )}
        <ThemedText type="footnote" themeColor="muted" style={styles.center}>
          Drag to rotate · pinch to zoom · tap to place the marker
        </ThemedText>
      </View>

      <View style={styles.footer}>
        <Button
          label={bodyMark ? 'Next' : 'Mark a spot to continue'}
          variant="brand"
          disabled={!bodyMark}
          onPress={() => setSheetOpen(true)}
        />
        <Pressable hitSlop={10} onPress={() => setSheetOpen(true)} style={styles.skip} accessibilityRole="button">
          <ThemedText type="headline" themeColor="brand">
            Skip
          </ThemedText>
        </Pressable>
      </View>

      <ActionSheet
        visible={sheetOpen}
        title="Choose image source"
        onClose={() => setSheetOpen(false)}
        options={[
          { key: 'camera', label: 'Camera', icon: 'camera.fill', onPress: () => router.push('/scan/capture') },
          { key: 'gallery', label: 'Photo gallery', icon: 'photo.on.rectangle', onPress: pickFromGallery },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  viewer: { flex: 1 },
  copy: { paddingHorizontal: Space.xl, gap: Space.xs, paddingBottom: Space.lg },
  center: { textAlign: 'center' },
  footer: { paddingHorizontal: Space.xl, paddingBottom: Space.base, gap: Space.md, alignItems: 'center' },
  skip: { paddingVertical: Space.sm },
});
