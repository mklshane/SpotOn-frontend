import { Image, type ImageStyle } from 'expo-image';

const WORDMARK = require('@/assets/images/spoton-wordmark.png');
const MARK = require('@/assets/images/spoton-mark.png');

// Intrinsic aspect ratios of the source art (width / height).
const WORDMARK_AR = 2670 / 765; // full "SpotOn" lockup
const MARK_AR = 1; // viewfinder-spot glyph (square)

export type LogoProps = {
  /** Full "SpotOn" lockup, or just the viewfinder-spot mark. */
  variant?: 'wordmark' | 'mark';
  /** Width for the wordmark. */
  width?: number;
  /** Edge length for the square mark. */
  size?: number;
  /** Recolor the whole logo to a solid color (e.g. "#FFFFFF" for dark backgrounds). */
  tint?: string;
  style?: ImageStyle | ImageStyle[];
};

export function Logo({ variant = 'wordmark', width = 168, size = 48, tint, style }: LogoProps) {
  const dims =
    variant === 'mark'
      ? { width: size, height: size / MARK_AR }
      : { width, height: width / WORDMARK_AR };

  return (
    <Image
      source={variant === 'mark' ? MARK : WORDMARK}
      style={[dims, style]}
      contentFit="contain"
      tintColor={tint}
      accessibilityLabel="SpotOn"
    />
  );
}
