import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Cross-platform icon.
 *
 * iOS renders the real SF Symbol via `expo-symbols` (pixel-identical to before).
 * Android/web fall back to the closest `@expo/vector-icons` glyph so the UI keeps
 * the same shape and weight instead of rendering nothing (SymbolView is iOS-only).
 *
 * Call sites pass SF Symbol names exactly as they would to `SymbolView`.
 */
export type IconName = SymbolViewProps['name'];

type VectorSet = 'ionicons' | 'mci';
type VectorSpec = { set: VectorSet; name: string };

// SF Symbol → closest vector glyph. Keep this in sync when new SF Symbols are used.
const VECTOR_MAP: Record<string, VectorSpec> = {
  // chevrons / arrows
  'chevron.left': { set: 'ionicons', name: 'chevron-back' },
  'chevron.right': { set: 'ionicons', name: 'chevron-forward' },
  'chevron.up': { set: 'ionicons', name: 'chevron-up' },
  'chevron.down': { set: 'ionicons', name: 'chevron-down' },
  // glyphs
  checkmark: { set: 'ionicons', name: 'checkmark' },
  xmark: { set: 'ionicons', name: 'close' },
  calendar: { set: 'ionicons', name: 'calendar-outline' },
  eye: { set: 'ionicons', name: 'eye-outline' },
  'eye.slash': { set: 'ionicons', name: 'eye-off-outline' },
  sparkles: { set: 'ionicons', name: 'sparkles' },
  stethoscope: { set: 'mci', name: 'stethoscope' },
  'hammer.fill': { set: 'ionicons', name: 'hammer' },
  'lock.shield.fill': { set: 'ionicons', name: 'shield-checkmark' },
  'camera.viewfinder': { set: 'ionicons', name: 'scan-outline' },
  // tab bar + nav (outline = inactive, solid = active)
  house: { set: 'ionicons', name: 'home-outline' },
  'house.fill': { set: 'ionicons', name: 'home' },
  'building.2': { set: 'ionicons', name: 'business-outline' },
  'building.2.fill': { set: 'ionicons', name: 'business' },
  'camera.fill': { set: 'ionicons', name: 'camera' },
  book: { set: 'ionicons', name: 'book-outline' },
  'book.fill': { set: 'ionicons', name: 'book' },
  person: { set: 'ionicons', name: 'person-outline' },
  'person.fill': { set: 'ionicons', name: 'person' },
};

const FALLBACK: VectorSpec = { set: 'ionicons', name: 'ellipse-outline' };

/** SymbolView's `name` can be a string or a `{ ios, android, web }` object. */
function resolveSymbolName(name: IconName): string {
  if (typeof name === 'string') return name;
  const obj = name as { ios?: string; android?: string; web?: string };
  return obj.ios ?? obj.android ?? obj.web ?? '';
}

export type IconProps = {
  name: IconName;
  size?: number;
  /** Named to match SymbolView so existing call sites pass through unchanged. */
  tintColor?: string;
  weight?: SymbolViewProps['weight'];
  type?: SymbolViewProps['type'];
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 20, tintColor, weight, type, style }: IconProps) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView name={name} size={size} tintColor={tintColor} weight={weight} type={type} style={style} />
    );
  }

  const key = resolveSymbolName(name);
  const spec = VECTOR_MAP[key] ?? FALLBACK;
  if (__DEV__ && !VECTOR_MAP[key]) {
    console.warn(`[Icon] No Android mapping for SF Symbol "${key}" — using fallback glyph.`);
  }

  const Glyph = spec.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return (
    <Glyph
      name={spec.name as never}
      size={size}
      color={tintColor ?? '#000000'}
      style={style as StyleProp<TextStyle>}
    />
  );
}
