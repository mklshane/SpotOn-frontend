import Svg, { Circle, ClipPath, Defs, Ellipse, Path } from 'react-native-svg';

import type { AbcdeSign } from '@/data/learn-content';

export type MoleSwatchState = 'typical' | 'concern';

export type MoleSwatchProps = {
  sign: AbcdeSign;
  state: MoleSwatchState;
  size?: number;
};

/**
 * Captions for each half of a comparison pair. Four of the five signs are a
 * "this is normal, this is not" contrast; evolving is a before-and-after of the
 * same mole, so it gets its own wording.
 */
export const SIGN_CAPTIONS: Record<AbcdeSign, { typical: string; concern: string }> = {
  asymmetry: { typical: 'Usually fine', concern: 'Worth checking' },
  border: { typical: 'Usually fine', concern: 'Worth checking' },
  color: { typical: 'Usually fine', concern: 'Worth checking' },
  diameter: { typical: 'Usually fine', concern: 'Worth checking' },
  evolving: { typical: 'Earlier', concern: 'Months later' },
};

// A deliberately limited palette so the five diagrams read as one set, and warm
// enough that a page of them never looks clinical or alarming.
const SKIN = '#F2C8A6';
const SHINE = 'rgba(255,255,255,0.22)';
const MOLE = '#7A4526';
const MOLE_DARK = '#3E1C10';
const MOLE_LIGHT = '#B8794E';
const MOLE_PALE = '#D9A177';
const GUIDE = '#8C6A52';
const GUIDE_ON_MOLE = '#FFEEDF';

/**
 * One half of an ABCDE comparison diagram: a mole drawn on the same warm skin
 * disc every time, so the only thing that changes between the two halves is the
 * sign being illustrated. Abstract on purpose, since real lesion photography
 * does not belong in a browsing context.
 */
export function MoleSwatch({ sign, state, size = 76 }: MoleSwatchProps) {
  // Ids must be unique per rendered SVG, and every pair of this component on a
  // page is a distinct sign/state combination.
  const clipId = `mole-clip-${sign}-${state}`;
  const concern = state === 'concern';

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx="48" cy="48" r="44" />
        </ClipPath>
      </Defs>

      <Circle cx="48" cy="48" r="44" fill={SKIN} />
      <Ellipse cx="34" cy="30" rx="18" ry="12" fill={SHINE} />

      {sign === 'asymmetry' ? (
        concern ? (
          <Path
            clipPath={`url(#${clipId})`}
            d="M44 31 C58 28 72 38 70 52 C68 64 56 70 46 67 C38 65 33 57 34 48 C35 40 38 33 44 31 Z"
            fill={MOLE}
          />
        ) : (
          <Circle clipPath={`url(#${clipId})`} cx="48" cy="48" r="16" fill={MOLE} />
        )
      ) : null}

      {sign === 'border' ? (
        concern ? (
          <Path
            clipPath={`url(#${clipId})`}
            d="M48 30 L55 34 L59 29 L63 37 L68 40 L64 47 L69 53 L61 56 L58 64 L50 61 L44 66 L40 58 L32 57 L34 49 L29 43 L36 40 L37 32 L44 35 Z"
            fill={MOLE}
          />
        ) : (
          <Circle clipPath={`url(#${clipId})`} cx="48" cy="48" r="16" fill={MOLE} />
        )
      ) : null}

      {sign === 'color' ? (
        <>
          <Circle clipPath={`url(#${clipId})`} cx="48" cy="48" r="16" fill={concern ? MOLE_LIGHT : MOLE} />
          {concern ? (
            <>
              <Path
                clipPath={`url(#${clipId})`}
                d="M48 32 C57 32 64 39 64 48 C58 50 52 46 48 50 C44 54 40 52 34 54 C32 42 39 32 48 32 Z"
                fill={MOLE_DARK}
              />
              <Ellipse clipPath={`url(#${clipId})`} cx="54" cy="57" rx="7" ry="5" fill={MOLE_PALE} />
              <Circle clipPath={`url(#${clipId})`} cx="40" cy="58" r="4" fill={MOLE_DARK} opacity={0.75} />
            </>
          ) : null}
        </>
      ) : null}

      {sign === 'diameter' ? (
        <>
          <Circle clipPath={`url(#${clipId})`} cx="48" cy="48" r={concern ? 24 : 10} fill={MOLE} />
          {/* The same 6mm reference ring sits in both halves, so the size
              difference is measured rather than just implied. It is drawn last
              so it stays visible where the larger mole covers it. */}
          <Circle
            clipPath={`url(#${clipId})`}
            cx="48"
            cy="48"
            r="16"
            fill="none"
            stroke={concern ? GUIDE_ON_MOLE : GUIDE}
            strokeWidth="1.6"
            strokeDasharray="4 4"
            opacity={0.75}
          />
        </>
      ) : null}

      {sign === 'evolving' ? (
        <>
          <Circle clipPath={`url(#${clipId})`} cx="48" cy="48" r={concern ? 21 : 11} fill={MOLE} />
          {/* On the "months later" half, the dashed outline marks the mole's
              earlier size so the growth is visible in one glance. */}
          {concern ? (
            <Circle
              clipPath={`url(#${clipId})`}
              cx="48"
              cy="48"
              r="11"
              fill="none"
              stroke={GUIDE_ON_MOLE}
              strokeWidth="1.6"
              strokeDasharray="4 4"
              opacity={0.8}
            />
          ) : null}
        </>
      ) : null}
    </Svg>
  );
}
