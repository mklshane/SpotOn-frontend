import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/hooks/use-theme';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.full_name?.trim() || 'Your profile';
  const identifier = user?.email || user?.phone || '';

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace('/(auth)/login');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="largeTitle">Profile</ThemedText>
      </View>

      <Card style={styles.identity}>
        <IconCircle icon="person.fill" variant="gradient" size={60} />
        <View style={styles.identityText}>
          <ThemedText type="headline">{name}</ThemedText>
          {identifier ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {identifier}
            </ThemedText>
          ) : null}
        </View>
      </Card>

      <Pressable
        onPress={() => router.push('/scan/history')}
        accessibilityRole="button"
        style={({ pressed }) => pressed && styles.pressed}>
        <Card style={styles.row}>
          <IconCircle icon="figure.stand" variant="tint" size={48} />
          <View style={styles.rowText}>
            <ThemedText type="headline">See body lesions</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              View your screening history on the 3D body
            </ThemedText>
          </View>
          <Icon name="chevron.right" tintColor={theme.muted} size={18} />
        </Card>
      </Pressable>

      <View style={styles.actions}>
        <Button
          label="Sign out"
          variant="outline"
          loading={signingOut}
          onPress={handleSignOut}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Space.lg },
  identity: { marginTop: Space.xl, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  identityText: { flex: 1, gap: 2 },
  row: { marginTop: Space.base, flexDirection: 'row', alignItems: 'center', gap: Space.base },
  rowText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
  actions: { marginTop: 'auto', paddingBottom: Space.base },
});
