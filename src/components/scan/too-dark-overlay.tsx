import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Space } from '@/constants/theme';

/**
 * Full-screen "It's too dark" coaching overlay for the capture screen (matches
 * assets/inspo/5-too-dark.jpeg). Detection is wired in the vision-camera/ML phase;
 * for now this is rendered only when a `tooDark` flag is set.
 */
export function TooDarkOverlay() {
  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.copy}>
        <ThemedText type="title2" style={styles.title}>
          It&apos;s too dark
        </ThemedText>
        <ThemedText type="body" style={styles.subtitle}>
          Turn on a flash or change the lighting conditions
        </ThemedText>
      </View>
      <View style={styles.ring}>
        <Icon name="sun.max" tintColor="rgba(255,255,255,0.95)" size={44} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,16,13,0.82)',
    gap: Space.xxl,
    paddingHorizontal: Space.xl,
  },
  copy: { alignItems: 'center', gap: Space.sm },
  title: { color: '#FFFFFF', textAlign: 'center' },
  subtitle: { color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  ring: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
