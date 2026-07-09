import { Stack } from 'expo-router';

export default function DirectoryDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="clinic" />
      <Stack.Screen name="doctor" />
    </Stack>
  );
}
