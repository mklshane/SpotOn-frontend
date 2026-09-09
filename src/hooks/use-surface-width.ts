import { Platform, useWindowDimensions } from 'react-native';

import { AppMaxWidth } from '@/constants/theme';

/**
 * Width of the app surface - what a full-bleed child can actually occupy.
 *
 * On native that is the window. On web the root layout clamps the app to
 * `AppMaxWidth` with `overflow: hidden` (see app/_layout.tsx), so a screen that
 * sized itself to `useWindowDimensions().width` would lay out against the whole
 * browser window and have everything past the clamp silently clipped - which is
 * exactly what happened to the onboarding, instructions and questionnaire pagers.
 *
 * The clamp is a constant, so this is derived rather than measured: an `onLayout`
 * provider would report 0 on the first paint, and these values get baked into
 * `getItemLayout`, where a 0 would break paging outright.
 */
export function useSurfaceWidth() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, AppMaxWidth) : width;
}
