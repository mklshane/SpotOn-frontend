import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconCircle } from '@/components/ui/icon-circle';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
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
  actions: { marginTop: 'auto', paddingBottom: Space.base },
});
