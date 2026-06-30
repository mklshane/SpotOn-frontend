import { Stack } from 'expo-router';

export default function ScanLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="body" />
      <Stack.Screen name="capture" options={{ animation: 'fade' }} />
      <Stack.Screen name="crop" options={{ animation: 'fade' }} />
      <Stack.Screen name="quality" options={{ animation: 'fade' }} />
      <Stack.Screen name="instructions" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="history" />
      <Stack.Screen name="result" />
    </Stack>
  );
}
