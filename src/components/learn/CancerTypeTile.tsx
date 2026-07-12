import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, Type } from '@/constants/theme';

export type CancerTypeKind = 'melanoma' | 'scc' | 'bcc';

export type CancerTypeTileProps = {
  kind: CancerTypeKind;
  letter: string;
  title: string;
  severity: string;
  /** Saturated tile background (risk-tier color). */
  color: string;
  onPress: () => void;
};

/**
 * Abstract artwork per cancer type, drawn to evoke what the lesion looks like
 * without being clinical imagery: melanoma = an asymmetric, irregular-border
 * mole; SCC = a rough, scaly patch; BCC = a smooth pearly bump. Shapes bleed
 * off the tile's right edge like a soft 3D object catching light.
 */
function TileArt({ kind }: { kind: CancerTypeKind }) {
  if (kind === 'melanoma') {
    return (
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 160 180" preserveAspectRatio="xMaxYMax slice">
        <Defs>
          <RadialGradient id="mel" cx="60%" cy="45%" r="70%">
            <Stop offset="0%" stopColor="#5A1114" stopOpacity="0.85" />
            <Stop offset="100%" stopColor="#7E1B20" stopOpacity="0.65" />
          </RadialGradient>
        </Defs>
        {/* asymmetric mole with an irregular border (the A + B of ABCDE) */}
        <Path
          d="M96 38 C126 30 158 46 168 76 C178 108 162 128 146 142 C128 158 112 150 100 160 C86 172 66 164 62 146 C57 124 70 118 66 100 C62 80 74 44 96 38 Z"
          fill="url(#mel)"
        />
        {/* uneven color: darker satellite patches inside */}
        <Ellipse cx="118" cy="86" rx="17" ry="13" fill="#3F0A0D" opacity={0.55} />
        <Ellipse cx="96" cy="120" rx="10" ry="8" fill="#3F0A0D" opacity={0.4} />
        <Circle cx="136" cy="118" r="7" fill="#2E0608" opacity={0.45} />
      </Svg>
    );
  }
  if (kind === 'scc') {
    return (
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 160 180" preserveAspectRatio="xMaxYMax slice">
        <Defs>
          <RadialGradient id="sccA" cx="40%" cy="30%" r="80%">
            <Stop offset="0%" stopColor="#FFD9BE" stopOpacity="0.95" />
            <Stop offset="100%" stopColor="#F79A5C" stopOpacity="0.75" />
          </RadialGradient>
        </Defs>
        {/* raised scaly patch: overlapping crusty flakes */}
        <Path d="M84 70 L128 52 L166 80 L150 118 L104 112 Z" fill="url(#sccA)" opacity={0.9} />
        <Path d="M104 108 L150 96 L172 132 L140 162 L100 146 Z" fill="#B23F10" opacity={0.55} />
        <Path d="M120 46 L158 34 L176 62 L148 78 Z" fill="#FFE8D6" opacity={0.5} />
        {/* flake specks */}
        <Circle cx="98" cy="92" r="4" fill="#FFE8D6" opacity={0.8} />
        <Circle cx="132" cy="140" r="5" fill="#FFD9BE" opacity={0.6} />
        <Circle cx="150" cy="70" r="3.5" fill="#8F2F08" opacity={0.5} />
      </Svg>
    );
  }
  // bcc — smooth pearly translucent bump with a soft highlight
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 160 180" preserveAspectRatio="xMaxYMax slice">
      <Defs>
        <RadialGradient id="bcc" cx="38%" cy="32%" r="75%">
          <Stop offset="0%" stopColor="#FFF6E8" stopOpacity="0.95" />
          <Stop offset="55%" stopColor="#FBD9A0" stopOpacity="0.8" />
          <Stop offset="100%" stopColor="#D98A1F" stopOpacity="0.7" />
        </RadialGradient>
      </Defs>
      <Circle cx="128" cy="112" r="62" fill="url(#bcc)" />
      {/* pearly shine */}
      <Ellipse cx="106" cy="86" rx="18" ry="11" fill="#FFFFFF" opacity={0.65} />
      {/* the fine surface vessel BCCs often show, kept abstract */}
      <Path
        d="M120 132 C130 126 138 130 148 122"
        stroke="#B4651A"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity={0.45}
      />
    </Svg>
  );
}

/** App-store-style tile: saturated background, monogram chip, artwork bleeding
 * off the corner, bold white title + severity line. */
export function CancerTypeTile({ kind, letter, title, severity, color, onPress }: CancerTypeTileProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[styles.tile, { backgroundColor: color }]}>
        <TileArt kind={kind} />
        <View style={styles.chip}>
          <ThemedText style={styles.chipLetter}>{letter}</ThemedText>
        </View>
        <View style={styles.footer}>
          <ThemedText style={styles.title} numberOfLines={3}>
            {title}
          </ThemedText>
          <ThemedText style={styles.severity} numberOfLines={1}>
            {severity}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 160,
    height: 185,
    borderRadius: Radius.xl,
    padding: Space.base,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  chip: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(20,8,6,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLetter: {
    color: '#FFFFFF',
    fontSize: Type.headline.fontSize,
    lineHeight: Type.headline.lineHeight,
    fontFamily: Type.headline.fontFamily,
  },
  footer: { gap: 2 },
  title: {
    color: '#FFFFFF',
    fontSize: Type.headline.fontSize,
    lineHeight: Type.headline.lineHeight,
    fontFamily: Type.headline.fontFamily,
  },
  severity: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: Type.caption.fontSize,
    lineHeight: Type.caption.lineHeight,
    fontWeight: '600',
  },
});
