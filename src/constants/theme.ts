/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // existing template keys (kept — used by themed-text/view + app-tabs)
    text: '#211A15', // warm near-black (never pure #000)
    background: '#FFF9F4', // warm off-white
    backgroundElement: '#FBF0E8',
    backgroundSelected: '#FFE1CE',
    textSecondary: '#7C6E64',
    // brand — sunset
    brand: '#FF8A4C',
    brandPressed: '#F26A2E',
    brandBright: '#FFA468',
    brandTint: '#FFE9DA',
    onBrand: '#FFFFFF',
    muted: '#A99C92',
    // surfaces
    surface: '#FFFFFF',
    elementBg: '#FBF0E8',
    hairline: '#F1E5DB',
    // risk tiers (triage)
    riskLow: '#34A878',
    riskLowBg: '#E7F6EF',
    riskModerate: '#F2A93B',
    riskModerateBg: '#FFF4DE',
    riskHigh: '#E5571B',
    riskHighBg: '#FFE6D7',
    riskCritical: '#E04347',
    riskCriticalBg: '#FCE7E7',
  },
  dark: {
    // STUB — warm-dark, not built out yet. Mirror keys; refine later.
    text: '#FBF1EA',
    background: '#171210',
    backgroundElement: '#2A211B',
    backgroundSelected: '#3A2A20',
    textSecondary: '#C9BBB0',
    brand: '#FF8A4C',
    brandPressed: '#F26A2E',
    brandBright: '#FFA468',
    brandTint: '#3A2A20',
    onBrand: '#1A130E',
    muted: '#8C7E73',
    surface: '#211A15',
    elementBg: '#2A211B',
    hairline: '#2E2620',
    riskLow: '#3FBA88',
    riskLowBg: '#16271F',
    riskModerate: '#F2B454',
    riskModerateBg: '#2A2113',
    riskHigh: '#F26A33',
    riskHighBg: '#2C1810',
    riskCritical: '#F05B5F',
    riskCriticalBg: '#2A1414',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Gradients (use with expo-linear-gradient). Tuples of color stops.
// Gradients (use with expo-linear-gradient). `colors` + optional `locations`.
export const Gradients = {
  // Warm pastel screen background — pale yellow → cream → soft peach (matches the mock).
  dawn: {
    colors: ['#FCF4D6', '#FEF8EC', '#FBE5D2', '#F7D5BE'] as const,
    locations: [0, 0.35, 0.72, 1] as const,
  },
  sunsetSoft: { colors: ['#FFE9D6', '#FFD7C0', '#FFC3AC'] as const, locations: [0, 0.5, 1] as const },
  sunsetWarm: { colors: ['#FFD9B8', '#FFB98E', '#FF9E78'] as const, locations: [0, 0.5, 1] as const },
  sunsetVivid: { colors: ['#FFA468', '#FF8A4C', '#F26A2E'] as const, locations: [0, 0.5, 1] as const },
};

export const Radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

// Spacing — clean 4px scale (supersedes the template's half/one/two names).
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  giant: 64,
} as const;

// Type ramp. Display family names are wired up in _layout via useFonts.
export const Type = {
  largeTitle: { fontSize: 34, lineHeight: 40, fontFamily: 'Display-Bold' },
  title1: { fontSize: 28, lineHeight: 34, fontFamily: 'Display-Bold' },
  title2: { fontSize: 22, lineHeight: 28, fontFamily: 'Display-SemiBold' },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: 'Display-SemiBold' },
  body: { fontSize: 17, lineHeight: 24 }, // SF Pro (system) — omit fontFamily
  callout: { fontSize: 15, lineHeight: 20 },
  subhead: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;

// Soft warm shadows. Spread into a style; includes Android elevation.
export const Elevation = {
  sm: { shadowColor: '#7A4A2B', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: '#7A4A2B', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  lg: { shadowColor: '#7A4A2B', shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
