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
  'photo.on.rectangle': { set: 'ionicons', name: 'images-outline' },
  'bolt.fill': { set: 'ionicons', name: 'flash' },
  'bolt.slash.fill': { set: 'ionicons', name: 'flash-off' },
  'arrow.counterclockwise': { set: 'ionicons', name: 'refresh' },
  'clock.arrow.circlepath': { set: 'mci', name: 'history' },
  'checkmark.circle.fill': { set: 'ionicons', name: 'checkmark-circle' },
  'exclamationmark.triangle.fill': { set: 'ionicons', name: 'warning' },
  'figure.stand': { set: 'mci', name: 'human' },
  plus: { set: 'ionicons', name: 'add' },
  'sun.max': { set: 'ionicons', name: 'sunny-outline' },
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
  // settings / account
  'gearshape.fill': { set: 'ionicons', name: 'settings' },
  'bell.fill': { set: 'ionicons', name: 'notifications' },
  'lock.fill': { set: 'ionicons', name: 'lock-closed' },
  'key.fill': { set: 'ionicons', name: 'key' },
  'trash.fill': { set: 'ionicons', name: 'trash' },
  'shield.fill': { set: 'ionicons', name: 'shield' },
  'questionmark.circle.fill': { set: 'ionicons', name: 'help-circle' },
  'doc.text.fill': { set: 'ionicons', name: 'document-text' },
  'envelope.fill': { set: 'ionicons', name: 'mail' },
  'info.circle.fill': { set: 'ionicons', name: 'information-circle' },
  pencil: { set: 'ionicons', name: 'pencil' },
  // directory
  'magnifyingglass': { set: 'ionicons', name: 'search' },
  'xmark.circle.fill': { set: 'ionicons', name: 'close-circle' },
  minus: { set: 'ionicons', name: 'remove' },
  'star.fill': { set: 'ionicons', name: 'star' },
  'clock.fill': { set: 'ionicons', name: 'time' },
  banknote: { set: 'mci', name: 'cash' },
  'phone.fill': { set: 'ionicons', name: 'call' },
  globe: { set: 'ionicons', name: 'globe-outline' },
  'arrow.up.arrow.down': { set: 'ionicons', name: 'swap-vertical' },
  'mappin.circle.fill': { set: 'ionicons', name: 'location' },
  'wifi.slash': { set: 'ionicons', name: 'cloud-offline-outline' },
  'checkmark.seal.fill': { set: 'ionicons', name: 'checkmark-circle' },
  'arrow.triangle.turn.up.right.diamond.fill': { set: 'ionicons', name: 'navigate' },
  'arrow.up.right': { set: 'ionicons', name: 'open-outline' },
  // learn
  'cross.case.fill': { set: 'ionicons', name: 'medkit' },
  'square.grid.2x2.fill': { set: 'ionicons', name: 'grid' },
  'sun.max.fill': { set: 'ionicons', name: 'sunny' },
  // screening questionnaire + results
  'arrow.triangle.2.circlepath': { set: 'ionicons', name: 'sync' },
  'bandage.fill': { set: 'mci', name: 'bandage' },
  scribble: { set: 'mci', name: 'gesture' },
  'drop.fill': { set: 'ionicons', name: 'water' },
  allergens: { set: 'mci', name: 'blur' },
  'ruler.fill': { set: 'mci', name: 'ruler' },
  'circle.grid.2x2.fill': { set: 'ionicons', name: 'apps' },
  'chart.bar.fill': { set: 'ionicons', name: 'stats-chart' },
  'brain.head.profile': { set: 'mci', name: 'brain' },
  'list.bullet.clipboard.fill': { set: 'ionicons', name: 'clipboard' },
  'square.and.arrow.up': { set: 'ionicons', name: 'share-outline' },
  'arrow.up.left.and.arrow.down.right': { set: 'ionicons', name: 'expand' },
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
