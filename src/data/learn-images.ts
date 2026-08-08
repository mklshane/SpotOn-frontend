import type { ImageSourcePropType } from 'react-native';

/**
 * Slots for real clinical photography in the Education module.
 *
 * Every slot holds a real photograph. Two provenance groups:
 *
 * Externally sourced, all CC0 or CC BY. Both permit this use, including
 * commercially, so the project is not locked into staying non-commercial. Each
 * carries its attribution in `credit`, which the article's Image Credits section
 * renders automatically. Most come from the ISIC Archive; the two
 * `abcde-evolving-*` slots come from a CC BY case report instead, because a
 * genuine before-and-after needs the same lesion on the same person at two dated
 * points and ISIC is built around single images per lesion. That pair is
 * dermoscopic rather than clinical, which the UI labels outright.
 *
 * Project-supplied, added 2026-08-08: the four melanoma subtypes, the three BCC
 * subtypes other than superficial, `scc-keratoacanthoma`, and `melanoma-example`.
 * These are clinical naked-eye views, which is why the melanoma subtypes no
 * longer carry `modality: 'dermoscopic'`. They come from the DDI and SCIN
 * datasets and share `DATASET_CREDIT` below, whose comment records a licensing
 * question that has to be settled before release.
 *
 * See docs/education-image-shortlist.md for the full audit trail.
 */

export type ImageCredit = {
  org: string;
  /**
   * Page the image came from, shown as "View original". Omitted where a credit
   * covers more than one dataset and no single page would be honest to link to;
   * the row then renders as plain text.
   */
  url?: string;
  /** e.g. "CC BY-NC-ND 4.0". Recorded so the licence travels with the asset. */
  licence: string;
};

/**
 * Shared credit for the project-supplied photographs. They come from the DDI and
 * SCIN dermatology datasets, and which image came from which was not recorded, so
 * both are named on every one rather than either being guessed at.
 *
 * Read the licences before release. SCIN's Data Use License permits redistribution
 * with attribution and forbids re-identifying contributors. DDI's Stanford Research
 * Use Agreement is far narrower: personal, non-commercial research only, and it
 * states outright that you may not distribute, publish, or reproduce any portion of
 * the dataset without prior written permission. Shipping these inside an installable
 * app is distribution. Since the two datasets are not separated here, that
 * restriction has to be assumed to cover all nine until each image is traced back to
 * its dataset or Stanford grants permission.
 */
const DATASET_CREDIT: ImageCredit = {
  org: 'DDI (Stanford Medicine) and SCIN (Google Health & Stanford Medicine) dermatology datasets',
  licence: 'DDI Research Use Agreement; SCIN Data Use License',
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
  // Melanoma subtypes. All four are clinical, naked-eye photographs supplied by
  // the project on 2026-08-08, replacing the dermoscopic ISIC images that stood
  // here before. ISIC only labels subtypes on dermoscopic images, so those four
  // showed a magnified instrument view of a lesion nobody would recognise in a
  // mirror. These show what the reader would actually see on their own skin,
  // which is the whole job of a "what it may look like" slot.
  'melanoma-superficial-spreading': {
    needs: 'Documented superficial spreading melanoma.',
    alt: 'A flat, irregularly shaped patch mixing brown, black, and pink shades',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/melanoma-superficial-spreading.jpg'),
    credit: DATASET_CREDIT,
  },
  'melanoma-nodular': {
    needs: 'Documented nodular melanoma.',
    alt: 'A raised, dome-shaped dark nodule on an arm',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/melanoma-nodular.jpg'),
    credit: DATASET_CREDIT,
  },
  'melanoma-lentigo-maligna': {
    needs: 'Documented lentigo maligna melanoma.',
    alt: 'A large, flat, freckle-like patch of uneven tan and brown on sun-damaged skin',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/melanoma-lentigo-maligna.jpg'),
    credit: DATASET_CREDIT,
  },
  'melanoma-acral': {
    needs: 'Documented acral or acral-lentiginous melanoma.',
    alt: 'A wide dark band running the length of a thumbnail',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/melanoma-acral.jpg'),
    credit: DATASET_CREDIT,
  },
  // BCC subtypes. Nodular, pigmented, and morpheaform are project-supplied
  // clinical photographs; superficial still comes from NCI Visuals Online.
  'bcc-nodular': {
    needs: 'Documented nodular basal cell carcinoma.',
    alt: 'A pearly, translucent pink nodule typical of nodular basal cell carcinoma',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/bcc-nodular.jpg'),
    credit: DATASET_CREDIT,
  },
  'bcc-superficial': {
    needs: 'Sourced. National Cancer Institute Visuals Online, photographed by Kelly Nelson MD.',
    alt: 'A reddish-brown, slightly raised patch of superficial basal cell carcinoma',
    photoRequired: true,
    fit: 'contain',
    asset: require('@/assets/images/learn/clinical/nci-superficial-bcc.jpg'),
    credit: {
      org: 'Kelly Nelson MD, National Cancer Institute Visuals Online',
      url: 'https://commons.wikimedia.org/wiki/File:Superficial_basal_cell_carcinoma.jpg',
      licence: 'CC0 1.0 (public domain)',
    },
  },
  'bcc-morpheaform': {
    needs: 'Documented morpheaform basal cell carcinoma.',
    alt: 'A pale, scar-like patch with poorly defined edges, typical of morpheaform basal cell carcinoma',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/bcc-morpheaform.jpg'),
    credit: DATASET_CREDIT,
  },
  'bcc-pigmented': {
    needs: 'Documented pigmented basal cell carcinoma.',
    alt: 'A dark, glossy pigmented basal cell carcinoma at the hairline on brown skin',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/bcc-pigmented.jpg'),
    credit: DATASET_CREDIT,
  },
  // SCC subtypes. ISIC records no diagnosis_4 subtype for invasive squamous
  // cell carcinoma at all, and its Bowen disease images are CC BY-NC.
  'scc-bowens': {
    needs: 'Sourced. Figure 1 of Scurtu et al. 2024, a composite of clinical and dermoscopic panels.',
    alt: 'Clinical and dermoscopic views of two Bowen disease plaques',
    photoRequired: true,
    fit: 'contain',
    asset: require('@/assets/images/learn/clinical/diagnostics-2024-bowen-fig1.jpg'),
    credit: {
      org: 'Scurtu LG, et al. Diagnostics. 2024;14(16):1799 (Fig 1)',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11353497/',
      licence: 'CC BY 4.0',
    },
  },
  'scc-keratoacanthoma': {
    needs: 'Documented keratoacanthoma.',
    alt: 'A dome-shaped red nodule with a crusted central plug, typical of a keratoacanthoma',
    photoRequired: true,
    asset: require('@/assets/images/learn/clinical/scc-keratoacanthoma.jpg'),
    credit: DATASET_CREDIT,
  },
  // Deliberately a general squamous cell carcinoma, not an invasive one. The
  // NCI records this only as "squamous cell carcinoma", and invasion is a
  // histological finding no caption here confirms. The card says so rather than
  // letting the photo's placement imply a diagnosis the source does not make.
  'scc-invasive': {
    needs: 'Sourced. A general clinical example of squamous cell carcinoma from NCI Visuals Online.',
    alt: 'A scaly, ulcerated squamous cell carcinoma on the nose',
    photoRequired: true,
    fit: 'contain',
    asset: require('@/assets/images/learn/clinical/nci-scc-example.jpg'),
    credit: {
      org: 'National Cancer Institute Visuals Online',
      url: 'https://commons.wikimedia.org/wiki/File:Squamous_cell_carcinoma_crop.jpg',
      licence: 'CC0 1.0 (public domain)',
    },
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
    asset: require('@/assets/images/learn/clinical/ISIC_0024221.jpg'),
    credit: { org: 'ISIC Archive', url: 'https://api.isic-archive.com/api/v2/images/ISIC_0024221/',
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
    asset: require('@/assets/images/learn/clinical/melanoma-example.jpg'),
    credit: DATASET_CREDIT,
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

  // Keyed on org, not url: a credit covering several datasets carries no url,
  // and keying on an absent one would collapse every such credit into one row.
  return ids.reduce<ImageCredit[]>((credits, id) => {
    const { asset, credit } = CLINICAL_IMAGES[id];
    if (!asset || !credit || seen.has(credit.org)) return credits;
    seen.add(credit.org);
    return [...credits, credit];
  }, []);
}
