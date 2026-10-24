import { Redirect, router, Tabs, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { InteractionManager, Platform, View } from 'react-native';

import { CustomTabBar } from '@/components/ui/tab-bar';
import { needsInitialSync, runSync } from '@/data/sync';
import { useAuth } from '@/lib/auth';
import { prewarmBody } from '@/lib/body-variant';
import { ProductTourOverlay, useProductTour } from '@/lib/product-tour';
import { isDataRightsPending, readProductTourStatus } from '@/lib/product-tour-storage';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const { session, startFirstRun } = useProductTour();

  useEffect(() => {
    if (!user?.id || pathname !== '/home' || session) return;
    let cancelled = false;
    // New sign-ups see their data rights first (required), then the tour once they're back on Home.
    (async () => {
      if (await isDataRightsPending(user.id)) {
        if (!cancelled) router.push('/profile/rights?first=1');
        return;
      }
      if (!cancelled && (await readProductTourStatus(user.id)) === 'pending') startFirstRun(user.id);
    })().catch((e) => console.warn('[tour] could not read first-run state:', e));
    return () => { cancelled = true; };
  }, [user?.id, pathname, session, startFirstRun]);

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
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={Boolean(session)}
        importantForAccessibility={session ? 'no-hide-descendants' : 'auto'}>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={(props) => <CustomTabBar {...(props as any)} />}>
          <Tabs.Screen name="home" />
          <Tabs.Screen name="directory" />
          <Tabs.Screen name="scan" />
          <Tabs.Screen name="learn" />
          <Tabs.Screen name="profile" />
        </Tabs>
      </View>
      <ProductTourOverlay scope="tabs" />
    </View>
  );
}
