import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

export default function LearnDetailLayout() {
  const reduced = useReducedMotion();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Sliding is the transition for these screens, which is why nothing
        // inside them staggers on arrival. Reduced motion swaps the travel for
        // a cross-fade rather than dropping the transition entirely, so the
        // change of context is still legible.
        animation: reduced ? 'fade' : 'slide_from_right',
      }}>
      <Stack.Screen name="topic" />
      <Stack.Screen name="article" />
      <Stack.Screen name="questionnaire" />
    </Stack>
  );
}
