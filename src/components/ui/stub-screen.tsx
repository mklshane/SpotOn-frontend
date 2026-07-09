import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';
import { Screen } from './screen';

export type StubScreenProps = {
  title: string;
  body?: string;
};

export function StubScreen({ title, body = 'This document is coming soon.' }: StubScreenProps) {
  const theme = useTheme();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          {title}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <ThemedText type="body" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
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
  content: { paddingHorizontal: Space.xl, paddingTop: Space.lg },
});
