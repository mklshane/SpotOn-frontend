/**
 * Medical references shown at the foot of each Education article.
 *
 * Every URL below was fetched on 2026-08-08 and its page title read back from
 * the live page, so the titles here are the publishers' own, not paraphrases.
 * Nothing in this file may be written from memory: if a claim needs a source
 * that has not been checked, add a `PENDING_SOURCES` entry instead, which the
 * UI renders as an honest gap rather than a link.
 */

export type SourceRef = {
  org: string;
  title: string;
  url: string;
};

/** A citation that is still owed. Rendered as a visible gap, never as a link. */
export type PendingSource = {
  org: string;
  /** The claim in the article that this source is supposed to support. */
  claim: string;
};

export const SOURCES = {
  aadAbcde: {
    org: 'American Academy of Dermatology',
    title: 'What to look for: ABCDEs of melanoma',
    url: 'https://www.aad.org/public/diseases/skin-cancer/find/at-risk/abcdes',
  },
  aadSelfExam: {
    org: 'American Academy of Dermatology',
    title: 'Find skin cancer: How to perform a skin self-exam',
    url: 'https://www.aad.org/public/diseases/skin-cancer/find/check-skin',
  },
  aadOverview: {
    org: 'American Academy of Dermatology',
    title: 'Skin cancer: Symptoms, diagnosis, and causes',
    url: 'https://www.aad.org/public/diseases/skin-cancer',
  },
  aadBcc: {
    org: 'American Academy of Dermatology',
    title: 'Basal cell carcinoma: From symptoms to treatments',
    url: 'https://www.aad.org/public/diseases/skin-cancer/types/common/bcc/symptoms',
  },
  aadScc: {
    org: 'American Academy of Dermatology',
    title: 'Squamous cell carcinoma: From symptoms to treatments',
    url: 'https://www.aad.org/public/diseases/skin-cancer/types/common/scc/symptoms',
  },
  aadMelanoma: {
    org: 'American Academy of Dermatology',
    title: 'Skin cancer types: Melanoma signs and symptoms',
    url: 'https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/symptoms',
  },
  nciSkin: {
    org: 'National Cancer Institute',
    title: 'Skin Cancer (Including Melanoma): Patient Version',
    url: 'https://www.cancer.gov/types/skin',
  },
  nciPrevention: {
    org: 'National Cancer Institute',
    title: 'Skin Cancer Prevention (PDQ), Patient Version',
    url: 'https://www.cancer.gov/types/skin/patient/skin-prevention-pdq',
  },
  /**
   * Cited on the ABCDE page because its figures are the Evolving example, and
   * the 3mm to 5mm progression quoted there comes from this report.
   */
  satoTanakaEvolving: {
    org: 'Sato T, Tanaka M. Dermatology Practical & Conceptual',
    title:
      'A case of a superficial spreading melanoma in situ diagnosed via digital dermoscopic monitoring with high dynamic range conversion (2014)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4230260/',
  },
  whoUvIndex: {
    org: 'World Health Organization',
    title: 'Radiation: The ultraviolet (UV) index',
    url: 'https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index',
  },
} as const satisfies Record<string, SourceRef>;

export type SourceId = keyof typeof SOURCES;

/**
 * Claims that are still carrying an unverified source. These render in the app
 * as "Needs a verified source" so the gap is visible to a reviewer instead of
 * being quietly filled with a plausible-looking link.
 */
export const PENDING_SOURCES = {
  selfCheckFrequency: {
    org: 'Needs a dermatology body',
    claim:
      'That a monthly self-check is the right interval for most people. The AAD self-exam page advises checking regularly but does not state a frequency, so this number is not yet backed by the citation beside it.',
  },
  /**
   * Not attached to any article. The Prevention page used to state that PAGASA
   * publishes a daily UV Index forecast; its public site was checked on
   * 2026-08-08 and no UV Index product was found, so the claim was removed
   * rather than cited. Kept here so the finding is not silently lost, and so a
   * reviewer with better local knowledge can restore it with a real source.
   */
  pagasaUvIndex: {
    org: 'PAGASA',
    claim: 'That PAGASA publishes a daily UV Index forecast for the Philippines.',
  },
} as const satisfies Record<string, PendingSource>;

export type PendingSourceId = keyof typeof PENDING_SOURCES;
