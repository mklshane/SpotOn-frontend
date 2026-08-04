import { StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ART, ART_VIEW_BOX } from '@/lib/body-figure';
import { glyphIcon, regionGlyph, regionSide } from '@/lib/body-glyphs';
import { ICONS, ICON_VIEW_BOX } from '@/lib/body-icons';

/**
 * Illustration of the body part a tracked spot sits on.
 *
 * Two sources, chosen per region by glyphIcon(): published Health Icons artwork where the set has
 * a real match (head, arm, leg, foot, hand, spine, body), and our own drawings for the seven kinds
 * it doesn't cover — otherwise its single generic `joints` icon would render shoulder, elbow, hip
 * and knee identically. Both are drawn on the same 48×48 grid, so they sit at the same weight.
 *
 * A located spot is brand orange; a spot with no body mark falls back to the whole-body icon in
 * muted grey.
 */
export function BodyGlyph({ region, size = 64 }: { region?: string | null; size?: number }) {
  const theme = useTheme();
  const kind = regionGlyph(region);
  const icon = glyphIcon(kind);

  // Right-side regions are the same artwork flipped. Both sources draw one side only, and no body
  // part is asymmetric enough for the mirror to look wrong.
  const flip = regionSide(region) === 'right';
  const transform = flip ? 'translate(48,0) scale(-1,1)' : undefined;

  return (
    <View style={[styles.field, { backgroundColor: theme.elementBg }]}>
      {icon ? (
        <Svg width={size} height={size} viewBox={ICON_VIEW_BOX}>
          <G transform={transform}>
            {(ICONS[icon] ?? []).map((p, i) => (
              <Path
                key={i}
                d={p.d}
                fill={kind === 'body' ? theme.muted : theme.brand}
                fillRule={p.evenodd ? 'evenodd' : undefined}
              />
            ))}
          </G>
        </Svg>
      ) : (
        <Svg width={size} height={size} viewBox={ART_VIEW_BOX}>
          <G transform={transform}>
            {ART[kind].context?.map((d, i) => (
              <Path key={`c${i}`} d={d} fill={theme.backgroundSelected} />
            ))}
            {ART[kind].main.map((d, i) => (
              <Path key={`m${i}`} d={d} fill={theme.brand} />
            ))}
            {ART[kind].cut?.map((d, i) => (
              <Path key={`x${i}`} d={d} fill={theme.elementBg} />
            ))}
          </G>
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
});
