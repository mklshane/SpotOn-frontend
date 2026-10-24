import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ProductTourOverlay, useTourOnSettings } from '@/lib/product-tour';

export default function ProfileLayout() {
  const touring = useTourOnSettings();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={touring}
        importantForAccessibility={touring ? 'no-hide-descendants' : 'auto'}>
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="edit" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="terms" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="saved" />
          <Stack.Screen name="rights" />
        </Stack>
      </View>
      <ProductTourOverlay scope="settings" />
    </View>
  );
}
