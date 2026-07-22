import { Pressable, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space, Type } from '@/constants/theme';

export type CancerTypeKind = 'melanoma' | 'scc' | 'bcc';

export type CancerTypeCardProps = {
  kind: CancerTypeKind;
  title: string;
  /** Saturated accent (risk-tier color) — the learn-more link. */
  color: string;
  /** Soft tint (risk-tier bg color) — card background. */
  tint: string;
  onPress: () => void;
};

const ART_SIZE = 84;

/**
 * A circular "skin swatch" illustration per cancer type — abstract, not
 * clinical imagery. Each lesion is drawn on the same warm skin-tone disc so
 * the three cards read as a set: melanoma = an asymmetric, irregular-border,
 * unevenly colored mole (the A/B/C of ABCDE); SCC = a rough, scaly,
 * crusted patch; BCC = a smooth pearly bump with a fine surface vessel.
 */
function SkinSwatchArt({ kind }: { kind: CancerTypeKind }) {
  return (
    <Svg width={ART_SIZE} height={ART_SIZE} viewBox="0 0 96 96">
      <Defs>
        <RadialGradient id="skin" cx="38%" cy="32%" r="80%">
          <Stop offset="0%" stopColor="#F2C29B" />
          <Stop offset="100%" stopColor="#D99A70" />
        </RadialGradient>
        <ClipPath id="disc">
          <Circle cx="48" cy="48" r="44" />
        </ClipPath>
      </Defs>

      {/* the skin disc every lesion sits on */}
      <Circle cx="48" cy="48" r="44" fill="url(#skin)" />
      <Ellipse cx="34" cy="30" rx="18" ry="12" fill="#FFFFFF" opacity={0.18} />

      {kind === 'melanoma' ? (
        <>
          <Defs>
            <RadialGradient id="mel" cx="45%" cy="40%" r="75%">
              <Stop offset="0%" stopColor="#4A2318" />
              <Stop offset="100%" stopColor="#2E120B" />
            </RadialGradient>
          </Defs>
          {/* asymmetric mole with an irregular, notched border */}
          <Path
            clipPath="url(#disc)"
            d="M46 30 C58 26 70 32 73 43 C76 54 68 58 70 66 C72 75 62 80 54 77 C47 74 44 78 38 74 C30 69 33 62 30 56 C26 48 30 40 36 36 C39 34 42 31 46 30 Z"
            fill="url(#mel)"
          />
          {/* uneven color: satellite patches + a lighter brown zone */}
          <Ellipse clipPath="url(#disc)" cx="42" cy="46" rx="9" ry="7" fill="#6B3320" opacity={0.75} />
          <Ellipse clipPath="url(#disc)" cx="60" cy="60" rx="7" ry="6" fill="#1A0806" opacity={0.7} />
          <Circle clipPath="url(#disc)" cx="63" cy="42" r="4" fill="#1A0806" opacity={0.55} />
        </>
      ) : null}

      {kind === 'scc' ? (
        <>
          <Defs>
            <RadialGradient id="sccBase" cx="45%" cy="40%" r="75%">
              <Stop offset="0%" stopColor="#E8836A" />
              <Stop offset="100%" stopColor="#C74E2E" />
            </RadialGradient>
          </Defs>
          {/* inflamed base patch */}
          <Path
            clipPath="url(#disc)"
            d="M32 44 C34 34 46 28 56 31 C67 34 73 44 71 54 C69 64 60 70 50 69 C39 68 30 55 32 44 Z"
            fill="url(#sccBase)"
          />
          {/* rough, crusty scale flakes on top */}
          <Path clipPath="url(#disc)" d="M40 42 L52 36 L60 44 L54 52 L42 50 Z" fill="#F8D9BC" opacity={0.85} />
          <Path clipPath="url(#disc)" d="M50 52 L62 48 L66 58 L56 64 Z" fill="#F3C39A" opacity={0.7} />
          <Path clipPath="url(#disc)" d="M36 50 L44 54 L40 62 L33 57 Z" fill="#A93B1E" opacity={0.6} />
          {/* flake specks */}
          <Circle clipPath="url(#disc)" cx="58" cy="38" r="2.5" fill="#F8D9BC" opacity={0.9} />
          <Circle clipPath="url(#disc)" cx="46" cy="64" r="2" fill="#F8D9BC" opacity={0.7} />
        </>
      ) : null}

      {kind === 'bcc' ? (
        <>
          <Defs>
            <RadialGradient id="bcc" cx="40%" cy="34%" r="72%">
              <Stop offset="0%" stopColor="#FFF4E4" />
              <Stop offset="60%" stopColor="#F5D3A6" />
              <Stop offset="100%" stopColor="#DFA05C" />
            </RadialGradient>
          </Defs>
          {/* smooth pearly dome with a rolled border */}
          <Circle clipPath="url(#disc)" cx="50" cy="52" r="21" fill="url(#bcc)" />
          <Circle clipPath="url(#disc)" cx="50" cy="52" r="21" fill="none" stroke="#C98B4A" strokeWidth="1.5" opacity={0.5} />
          {/* specular shine that makes it read as translucent */}
          <Ellipse clipPath="url(#disc)" cx="43" cy="43" rx="8" ry="5" fill="#FFFFFF" opacity={0.8} />
          {/* fine surface vessels (telangiectasia), kept abstract */}
          <Path
            clipPath="url(#disc)"
            d="M42 60 C47 57 51 60 56 56"
            stroke="#C4652E"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
            opacity={0.6}
          />
          <Path
            clipPath="url(#disc)"
            d="M55 46 C58 48 61 47 63 50"
            stroke="#C4652E"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            opacity={0.45}
          />
        </>
      ) : null}
    </Svg>
  );
}

/** Rail card for the horizontal Skin Cancer Types scroll: soft risk-tint
 * surface, the skin-swatch artwork in a white medallion up top, title below,
 * and a quiet learn-more link pinned to the bottom. Scrolled left-to-right
 * the three cards read as a severity scale. */
export function CancerTypeCard({ kind, title, color, tint, onPress }: CancerTypeCardProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: tint }]}>
        <View style={styles.medallion}>
          <SkinSwatchArt kind={kind} />
        </View>
        <ThemedText type="headline" numberOfLines={2}>
          {title}
        </ThemedText>
        <View style={styles.learnRow}>
          <ThemedText style={[styles.learnLabel, { color }]}>Learn more</ThemedText>
          <Icon name="chevron.right" size={11} tintColor={color} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Fixed width (horizontal rail item) but height comes from the row's
  // alignItems: 'stretch' — see typeRow in learn.tsx — so every card matches
  // the tallest sibling's height regardless of title line-wrap.
  wrap: { width: 168 },
  card: {
    flex: 1,
    borderRadius: Radius.xl,
    padding: Space.base,
    paddingTop: Space.lg,
    gap: Space.sm,
    ...Elevation.sm,
  },
  // Soft white disc that lifts the artwork off the tinted card.
  medallion: {
    alignSelf: 'center',
    width: ART_SIZE + Space.base,
    height: ART_SIZE + Space.base,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  learnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 'auto',
  },
  learnLabel: {
    fontSize: Type.footnote.fontSize,
    lineHeight: Type.footnote.lineHeight,
    fontWeight: '600',
  },
});
