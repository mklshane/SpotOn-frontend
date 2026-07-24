import {
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/hanken-grotesk';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DevTools } from '@/components/ui/dev-tools';
import { AuthProvider } from '@/lib/auth';
import { ScanHistoryProvider } from '@/lib/scan-history';
import { ScreeningSessionProvider } from '@/lib/screening-session';

// The 3D body viewers read gesture-driven shared values inside r3f's `useFrame` loop — an
// intentional, correct pattern that Reanimated v4 strict mode over-flags. Disable strict mode
// (keep real warnings/errors), and silence three.js's benign "multiple instances" bundler notice.
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });
LogBox.ignoreLogs(['Multiple instances of Three.js being imported.']);

SplashScreen.preventAutoHideAsync().catch(() => {});

// Longest we'll hold the whole app behind the display font. On a low-end Android, font
// registration lands well inside this; if it doesn't, a few frames of the system face is a much
// better outcome than a splash screen that looks like the app failed to start.
const FONT_TIMEOUT_MS = 1000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Display-SemiBold': HankenGrotesk_600SemiBold,
    'Display-Bold': HankenGrotesk_700Bold,
  });
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFontsTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || !!fontError || fontsTimedOut;

  useEffect(() => {
    if (fontError) {
      console.error('Font load failed, continuing without custom fonts:', fontError);
    }
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready, fontError]);

  if (!ready) {
    return null; // keep the native splash visible until the display font is ready (or we give up)
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ScanHistoryProvider>
          <ScreeningSessionProvider>
            <ThemeProvider value={DefaultTheme}>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFF9F4' } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="scan" />
                <Stack.Screen name="profile" />
                <Stack.Screen name="directory" />
                <Stack.Screen name="learn" />
              </Stack>
              <DevTools />
            </ThemeProvider>
          </ScreeningSessionProvider>
          </ScanHistoryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
