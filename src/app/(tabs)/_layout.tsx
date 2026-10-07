import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { InteractionManager, Platform } from 'react-native';

import { CustomTabBar } from '@/components/ui/tab-bar';
import { needsInitialSync, runSync } from '@/data/sync';
import { useAuth } from '@/lib/auth';
import { prewarmBody } from '@/lib/body-variant';

export default function TabsLayout() {
  const { user, loading } = useAuth();

  // Seed the clinic directory as soon as the user is in, not only when they first open the Clinics
  // tab: someone who screens online and later looks for a clinic in airplane mode otherwise finds
  // an empty directory. Fire-and-forget; the Clinics tab joins this pass if it is still running.
  useEffect(() => {
    if (!user) return;
    needsInitialSync()
      .then((needed) => (needed ? runSync({ full: true }) : undefined))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || Platform.OS !== 'android') return;
    // After the first screens have rendered, not during: the mesh build is JS-thread work.
    const task = InteractionManager.runAfterInteractions(() => prewarmBody(user.sex));
    return () => task.cancel();
  }, [user]);

  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...(props as any)} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="directory" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="learn" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
