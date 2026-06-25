import { Redirect, Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/ui/tab-bar';
import { useAuth } from '@/lib/auth';

export default function TabsLayout() {
  const { user, loading } = useAuth();

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
