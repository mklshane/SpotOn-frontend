import { Stack } from 'expo-router';

export default function LearnDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="topic" />
      <Stack.Screen name="article" />
      <Stack.Screen name="questionnaire" />
    </Stack>
  );
}
