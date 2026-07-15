import type { ImageSourcePropType } from 'react-native';

import type { QuestionId } from './types';

/**
 * Per-question clinical reference photo shown on the questionnaire so users can *see* what
 * "crusty", "irregular edge", "ugly duckling" etc. actually look like before answering.
 *
 * Sources are openly licensed (public domain / CC) clinical images from Wikimedia Commons,
 * center-cropped to 700×420 and bundled under assets/reference/. Attribution + licenses live
 * in REFERENCE_IMAGE_CREDITS below and in assets/reference/ATTRIBUTION.md — keep them in sync.
 * Metro requires static require() literals, so this is an explicit map, not a computed path.
 */
export const REFERENCE_IMAGES: Partial<Record<QuestionId, ImageSourcePropType>> = {
  evolution: require('../../../assets/reference/evolution.jpg'),
  bleeding_nonhealing: require('../../../assets/reference/bleeding_nonhealing.jpg'),
  irregular_border: require('../../../assets/reference/irregular_border.jpg'),
  spontaneous_bleeding: require('../../../assets/reference/spontaneous_bleeding.jpg'),
  rough_scaly: require('../../../assets/reference/rough_scaly.jpg'),
  larger_7mm: require('../../../assets/reference/larger_7mm.jpg'),
  ugly_duckling: require('../../../assets/reference/ugly_duckling.jpg'),
  persistent_2mo: require('../../../assets/reference/persistent_2mo.jpg'),
};

/** Short, plain-language caption for what the reference photo is showing. */
export const REFERENCE_CAPTIONS: Partial<Record<QuestionId, string>> = {
  evolution: 'Example: a mole that grew and darkened over time',
  bleeding_nonhealing: 'Example: a spot that crusts and won’t finish healing',
  irregular_border: 'Example: a ragged, uneven edge',
  spontaneous_bleeding: 'Example: a raised spot that can bleed on its own',
  rough_scaly: 'Example: a rough, scaly, crusty patch',
  larger_7mm: 'Example: a spot wider than a pencil eraser',
  ugly_duckling: 'Example: one spot that stands out from the rest',
  persistent_2mo: 'Example: a spot that persists and doesn’t fade',
};

export type ReferenceImageCredit = {
  id: QuestionId;
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  sourceUrl: string;
};

/** Attribution for the reference photos, for an in-app licenses/credits screen. */
export const REFERENCE_IMAGE_CREDITS: readonly ReferenceImageCredit[] = [
  // NOTE: the five entries below were replaced 2026-07-15 with images supplied directly by the
  // product owner. Provenance/licensing is UNVERIFIED — some carry third-party watermarks
  // (e.g. sciencephoto.com, VisualDx). Confirm rights before shipping to production.
  {
    id: 'evolution',
    title: 'Evolving mole (before / after)',
    author: 'Provided by product owner',
    license: 'Unverified — confirm before release',
    sourceUrl: '',
  },
  {
    id: 'bleeding_nonhealing',
    title: 'Crusted non-healing lesion',
    author: 'Provided by product owner',
    license: 'Unverified — confirm before release',
    sourceUrl: '',
  },
  {
    id: 'irregular_border',
    title: 'Irregular-bordered pigmented lesion',
    author: 'Provided by product owner',
    license: 'Unverified — confirm before release',
    sourceUrl: '',
  },
  {
    id: 'spontaneous_bleeding',
    title: 'Spontaneously bleeding lesion',
    author: 'Provided by product owner',
    license: 'Unverified — confirm before release',
    sourceUrl: '',
  },
  {
    id: 'rough_scaly',
    title: 'Rough, scaly plaque',
    author: 'Provided by product owner',
    license: 'Unverified — confirm before release',
    sourceUrl: '',
  },
  {
    id: 'larger_7mm',
    title: 'Melanoma Diameter',
    author: 'National Cancer Institute',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Melanoma_Diameter.jpg',
  },
  {
    id: 'ugly_duckling',
    title: 'DysplasticNevusSyndrome',
    author: '0x6adb015',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:DysplasticNevusSyndrome.jpg',
  },
  {
    id: 'persistent_2mo',
    title: 'Squamous cell carcinoma (2)',
    author: 'Kelly Nelson (National Cancer Institute)',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Squamous_cell_carcinoma_(2).jpg',
  },
];
