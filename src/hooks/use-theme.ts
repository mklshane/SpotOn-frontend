import { Colors } from '@/constants/theme';

/**
 * The app is light-only. This intentionally ignores the system color scheme so
 * the UI always renders the light palette.
 */
export function useTheme() {
  return Colors.light;
}
