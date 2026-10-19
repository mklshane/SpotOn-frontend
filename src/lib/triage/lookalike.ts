import { t } from "../i18n/core";
import type { SourceId } from "../../data/learn-sources";
import type { LesionClass } from "./types";

/**
 * "Why it could be either" - the result screen's explanation for a combined malignant result
 * (pickCombinedMalignant in tps-core.ts): why the two named cancers can look alike in a photo, and
 * why only a dermatologist's exam and a biopsy can tell them apart.
 *
 * Every claim is cited. `[k]` in a body is the k-th entry of `sources`; the shared closing line
 * cites FREEMAN_APPS as the next number. Each source was opened and the claim found in its text on
 * 2026-10-18 (see the matching block in data/learn-sources.ts) - do not add a sentence here without
 * doing the same. scripts/test-lookalike.mjs checks every marker resolves to a real source.
 *
 * Bodies are literal t() calls inside a function, so they translate at render time and the i18n
 * coverage test sees every key.
 */
export type Lookalike = { body: string; sources: SourceId[] };

export type LookalikePair = 'BCC_MEL' | 'BCC_SCC' | 'MEL_SCC';

export const LOOKALIKE_SOURCES: Record<LookalikePair, SourceId[]> = {
  // Pigmented (nodular) BCC vs nodular melanoma - the look-alike that matters most in Filipino skin.
  BCC_MEL: [
    'dermnetBccSkinOfColour',
    'dermnetBcc',
    'dermnetNodularMelanoma',
    'villenaFilipinoBcc',
    'abuduPigmentedBcc',
    'dermnetBccDermoscopy',
  ],
  BCC_SCC: ['dermnetBcc', 'dermnetScc', 'healClinicalAccuracy', 'dinnesCochraneKeratinocyte'],
  MEL_SCC: [
    'dermnetAmelanoticMelanoma',
    'sohailAmelanoticSeries',
    'inouePigmentedBowen',
    'dinnesCochraneMelanoma',
  ],
};

/** Cited by the closing line every pair shares. */
export const FREEMAN_APPS: SourceId = 'freemanSkinCancerApps';

function body(pair: LookalikePair): string {
  switch (pair) {
    case 'BCC_MEL':
      return t(
        'Pigmented basal cell carcinoma and nodular melanoma can look very alike. Both often appear as a raised, dark brown or black bump [1][2][3], and both can break open, crust, or bleed [2][3]. In Filipino patients, most basal cell carcinomas are exactly this dark, raised type [4], so in a photo they are easy to mistake for melanoma [5]. The clues that separate them are small: basal cell carcinoma tends to grow slowly with a shiny, pearly, rolled edge [1][2], while nodular melanoma tends to grow quickly over weeks to months [3]. A dermatologist checks finer patterns with a dermatoscope, such as the blue-grey nests and branching blood vessels of basal cell carcinoma [3][6], and a small skin sample (biopsy) gives the final answer [5].',
      );
    case 'BCC_SCC':
      return t(
        'Basal cell and squamous cell carcinoma are both common skin cancers, and both can grow as a bump that may break open into a sore [1][2]. Squamous cell carcinoma is more often scaly or crusted, and basal cell carcinoma more often shiny or pearly [1][2], but the signs overlap, and even doctors sometimes mix them up by eye [3]. A dermatologist’s exam with a dermatoscope is more accurate than looking alone [4], and a small biopsy confirms which one it is [1][2].',
      );
    case 'MEL_SCC':
      return t(
        'Not every melanoma is dark. Some are pink or red, and they can look like squamous cell carcinoma [1][2]. The reverse also happens: some early squamous cell carcinomas are brown or black and can look like melanoma [3]. Only a dermatologist’s exam and a biopsy can tell them apart [1][4].',
      );
  }
}

/** The shared closing line; `n` is the citation number of FREEMAN_APPS in the card's list. */
export function lookalikeClosing(n: number): string {
  return t(
    'A photo shows less than a dermatologist sees in person, and skin-cancer apps cannot yet be relied on to catch every case [{{n}}]. Please have this spot checked so a dermatologist can give you a clear answer.',
    { n: String(n) },
  );
}

/** The explanation for a pair of malignant classes, in either order; null for any other pair. */
export function lookalikeFor(a: LesionClass, b: LesionClass): Lookalike | null {
  const pair = [a, b].sort().join('_');
  if (pair !== 'BCC_MEL' && pair !== 'BCC_SCC' && pair !== 'MEL_SCC') return null;
  return { body: body(pair), sources: LOOKALIKE_SOURCES[pair] };
}
