import type { ImageSourcePropType } from 'react-native';

/**
 * Slots for real clinical photography in the Education module.
 *
 * All thirteen slots hold real photographs, added 2026-08-08 and licensed CC0 or
 * CC BY. Both permit this use, including commercially, so the project is not
 * locked into staying non-commercial. Every image carries its attribution in
 * `credit`, which each article's Image Credits section renders automatically.
 *
 * Eleven come from the ISIC Archive. The two `abcde-evolving-*` slots come from
 * a CC BY case report instead, because a genuine before-and-after needs the same
 * lesion on the same person at two dated points, and ISIC is built around single
 * images per lesion. That pair is dermoscopic rather than clinical, which the UI
 * labels outright rather than glossing over.
 *
 * See docs/education-image-shortlist.md for the full audit trail.
 */

export type ImageCredit = {
  org: string;
  /** Page the image came from, shown as "View original". */
  url: string;
  /** e.g. "CC BY-NC-ND 4.0". Recorded so the licence travels with the asset. */
  licence: string;
};

export type ClinicalImageSpec = {
  /** What the photograph has to show. Written for whoever sources it. */
  needs: string;
  /** Alt text, authored now so it ships with the asset rather than after it. */
  alt: string;
  /** Set once a cleared file exists. Undefined leaves the slot empty. */
  asset?: ImageSourcePropType;
  /** Required whenever `asset` is set. */
  credit?: ImageCredit;
  /**
   * True where the slot's whole job is showing what something actually looks
   * like: the ABCDE signs, and the "What it may look like" example on each
   * cancer type. `ClinicalImage` refuses to draw an illustration in these
   * slots even if a caller passes one, and shows a labelled gap instead.
   *
   * A drawing of a mole is an artist's idea of a mole. Standing it in for a
   * clinical photograph would teach people to match their skin against
   * something no skin has ever looked like, which is worse than showing them
   * nothing and saying so.
   */
  photoRequired?: boolean;
  /**
   * How the image sits in its square frame. `cover` fills and crops, which is
   * right for a close-up already centred on the lesion. `contain` letterboxes,
   * for a published figure whose edges carry information a crop would destroy.
   */
  fit?: 'cover' | 'contain';
  /**
   * What the viewer is actually looking at. `dermoscopic` is a magnified view
   * through a medical instrument, so the frame says so: nobody should think
   * this is what their own skin looks like in a mirror.
   */
  modality?: 'clinical' | 'dermoscopic';
};

// Declared bare so `keyof typeof` yields the literal id union, then re-exported
// through the spec type so the optional `asset`/`credit` keys stay visible to
// callers. `as const satisfies ...` would narrow the absent keys out entirely.
const IMAGES = {
  'abcde-asymmetry-regular': {
    needs:
      'A benign mole that is close to round and symmetrical, photographed straight on, filling most of the frame.',
    alt: 'A round, evenly shaped mole',
    asset: require('@/assets/images/learn/clinical/ISIC_9377549.jpg'),
    credit: { org: 'Memorial Sloan Kettering Cancer Center, via ISIC Archive',
      url: 'https://api.isic-archive.com/api/v2/images/ISIC_9377549/', licence: 'CC BY 4.0' },
    photoRequired: true,
  },
  'abcde-asymmetry-irregular': {
    needs: 'A lesion where one half clearly does not mirror the other, photographed straight on.',
    alt: 'A mole whose two halves are shaped differently',
    asset: require('@/assets/images/learn/clinical/ISIC_0024258.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024258/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
  'abcde-border-even': {
    needs: 'A benign mole with a smooth, clearly defined edge against surrounding skin.',
    alt: 'A mole with a smooth, well defined edge',
    // Deliberately a different body site and skin type from the Asymmetry
    // photo above. Both were previously MSKCC nevi on the lower extremity,
    // which made two distinct images read as one repeated photo.
    asset: require('@/assets/images/learn/clinical/ISIC_7727119.jpg'),
    credit: { org: 'Memorial Sloan Kettering Cancer Center, via ISIC Archive',
      url: 'https://api.isic-archive.com/api/v2/images/ISIC_7727119/', licence: 'CC BY 4.0' },
    photoRequired: true,
  },
  'abcde-border-irregular': {
    needs: 'A lesion with a ragged, notched, or blurred edge that fades into the surrounding skin.',
    alt: 'A mole with a ragged, poorly defined edge',
    asset: require('@/assets/images/learn/clinical/ISIC_0024214.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024214/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
  'abcde-color-uniform': {
    needs: 'A benign mole of a single even brown throughout.',
    alt: 'A mole of one even brown shade',
    asset: require('@/assets/images/learn/clinical/ISIC_2486464.jpg'),
    credit: { org: 'Memorial Sloan Kettering Cancer Center, via ISIC Archive',
      url: 'https://api.isic-archive.com/api/v2/images/ISIC_2486464/', licence: 'CC BY 4.0' },
    photoRequired: true,
  },
  'abcde-color-varied': {
    needs:
      'A lesion showing several shades within one spot, for example tan with darker brown and black areas.',
    alt: 'A mole containing several different shades',
    asset: require('@/assets/images/learn/clinical/ISIC_0024228.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024228/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
  'abcde-diameter-small': {
    needs:
      'A lesion whose longest diameter is recorded in archive metadata and sits below 6mm, so the figure shown is traceable rather than estimated.',
    alt: 'A mole recorded as measuring 5.3mm across',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/ISIC_8092280.jpg'),
    credit: { org: 'Memorial Sloan Kettering Cancer Center, via ISIC Archive',
      url: 'https://api.isic-archive.com/api/v2/images/ISIC_8092280/', licence: 'CC BY 4.0' },
  },
  'abcde-diameter-large': {
    needs:
      'A lesion whose recorded longest diameter is comfortably above 6mm, for the same reason.',
    alt: 'A melanoma recorded as measuring 10.4mm across',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/ISIC_2222766.jpg'),
    credit: { org: 'Memorial Sloan Kettering Cancer Center, via ISIC Archive',
      url: 'https://api.isic-archive.com/api/v2/images/ISIC_2222766/', licence: 'CC BY 4.0' },
  },
  // The one longitudinal pair that could be licensed: same lesion, same
  // patient, seven months apart, published under CC BY. They are dermoscopic
  // rather than clinical, which the UI states plainly rather than papering over.
  'abcde-evolving-earlier': {
    needs: 'Sourced. Figure 1A of Sato & Tanaka 2014.',
    alt: 'Dermoscopic view of a 3mm pigmented lesion at the first consultation',
    photoRequired: true,
    fit: 'contain',
    modality: 'dermoscopic',
    asset: require('@/assets/images/learn/clinical/dpc-2014-sato-fig1a.jpg'),
    credit: {
      org: 'Sato T, Tanaka M. Dermatol Pract Concept. 2014;4(4):57-60 (Fig 1A)',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4230260/',
      licence: 'CC BY',
    },
  },
  'abcde-evolving-later': {
    needs: 'Sourced. Figure 2A of the same case report, seven months later.',
    alt: 'Dermoscopic view of the same lesion seven months later, now 5mm across',
    photoRequired: true,
    fit: 'contain',
    modality: 'dermoscopic',
    asset: require('@/assets/images/learn/clinical/dpc-2014-sato-fig2a.jpg'),
    credit: {
      org: 'Sato T, Tanaka M. Dermatol Pract Concept. 2014;4(4):57-60 (Fig 2A)',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4230260/',
      licence: 'CC BY',
    },
  },

  // One per type. Skin cancer looks different across skin tones, so each type
  // wants at least two examples before this ships; see the sourcing brief.
  'bcc-example': {
    needs:
      'Basal cell carcinoma on sun-exposed skin: a pearly or translucent raised bump. Needs a second example on darker skin, where it more often looks brown, black, or grey.',
    alt: 'A raised, pearly bump typical of basal cell carcinoma',
    asset: require('@/assets/images/learn/clinical/ISIC_0024262.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024262/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
  'scc-example': {
    needs:
      'Squamous cell carcinoma: a rough, scaly patch or firm dome-shaped growth on sun-exposed skin. Needs a second example on darker skin.',
    alt: 'A rough, scaly patch typical of squamous cell carcinoma',
    asset: require('@/assets/images/learn/clinical/ISIC_0024211.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024211/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
  'melanoma-example': {
    needs:
      'Melanoma showing several ABCDE features at once. Needs a second example on darker skin, where melanoma more often appears on palms, soles, or under nails.',
    alt: 'An asymmetric, unevenly coloured lesion typical of melanoma',
    asset: require('@/assets/images/learn/clinical/ISIC_0024292.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024292/',
      licence: 'CC0 1.0 (public domain)' },
    photoRequired: true,
  },
} satisfies Record<string, ClinicalImageSpec>;

export type ClinicalImageId = keyof typeof IMAGES;

export const CLINICAL_IMAGES: Record<ClinicalImageId, ClinicalImageSpec> = IMAGES;

export function getClinicalImage(id: ClinicalImageId): ClinicalImageSpec {
  return CLINICAL_IMAGES[id];
}

/** Slots still waiting on a cleared photograph. Drives the sourcing brief. */
export function pendingClinicalImages(): { id: ClinicalImageId; needs: string }[] {
  return (Object.keys(CLINICAL_IMAGES) as ClinicalImageId[])
    .filter((id) => !CLINICAL_IMAGES[id].asset)
    .map((id) => ({ id, needs: CLINICAL_IMAGES[id].needs }));
}

/** Credits for every slot currently rendering a real photograph. */
export function activeImageCredits(ids: readonly ClinicalImageId[]): ImageCredit[] {
  const seen = new Set<string>();

  return ids.reduce<ImageCredit[]>((credits, id) => {
    const { asset, credit } = CLINICAL_IMAGES[id];
    if (!asset || !credit || seen.has(credit.url)) return credits;
    seen.add(credit.url);
    return [...credits, credit];
  }, []);
}
