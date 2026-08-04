/**
 * Shared domain types for the post-capture screening workflow.
 * The scoring primitives live in tps-core.ts (kept import-free for the node harness);
 * this module re-exports them and adds the app-level record shapes.
 */
import type { Answer, LesionClass, QuestionId, TriageResult, TriageTier } from './tps-core';

export type {
  Answer,
  LesionClass,
  QuestionId,
  SymptomAnswers,
  TriageResult,
  TriageTier,
} from './tps-core';

/**
 * Where on the body the lesion is, captured on the 3D body screen. `point` is in the
 * body model's local space (stable across camera moves) so the marker can be
 * re-rendered read-only later. `region` is the human-readable label derived at tap time.
 */
export type BodyMark = {
  point: [number, number, number];
  region: string;
  view: 'front' | 'back';
};

export type QuestionnaireResponse = {
  answers: Record<QuestionId, Answer>;
  /** ISO timestamp. */
  completedAt: string;
};

/**
 * A tracked lesion — the spot itself, as distinct from any one observation of it.
 *
 * The body mark lives HERE rather than on the screening: it is a property of the lesion, and a
 * follow-up scan of the same spot must not require the user to re-place it. Screenings keep their
 * own `mark` as the audit trail of what was recorded at that moment.
 *
 * The rollup fields (screeningCount, first/lastScreenedAt, lastScreeningId, lastTier) are
 * denormalized from `screenings` so the list and 3D-body screens render without a per-row query.
 * They are recomputed by `refreshLesionRollup()` and are never authoritative.
 */
export type Lesion = {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp, bumped whenever a screening is linked. */
  updatedAt: string;
  /** User nickname. Null renders as "{region} spot" at display time — never stored derived. */
  label: string | null;
  mark: BodyMark | null;
  screeningCount: number;
  firstScreenedAt: string | null;
  lastScreenedAt: string | null;
  lastScreeningId: string | null;
  lastTier: TriageTier | null;
  /** "No longer tracking". Archived lesions are hidden from the body model, never hard-deleted. */
  archived: boolean;
  /** Recorded on create; deliberately never used in a WHERE clause while the app is
   *  single-account-on-device (pre-migration rows have NULL and would vanish from history). */
  userId: string | null;
};

/** One photo in a screening run. Index 0 is the primary — the hero, the thumbnail, the PDF image. */
export type ScreeningImage = {
  uri: string;
  index: number;
  source: 'camera' | 'gallery';
  /** The image-quality gate's verdict. False means the user chose "use anyway". */
  qualityPassed: boolean;
  /** Live-detector verdict carried over from capture; undefined for gallery uploads. */
  detected?: boolean;
};

/**
 * One image's own classification within a multi-photo screening. Recorded even when pooling is
 * disabled (model-config MULTI_IMAGE_AGGREGATION_ENABLED) — it is the field evidence a future
 * held-out refit of MALIGNANT_THRESHOLD would need.
 */
export type PerImageResult = {
  index: number;
  uri: string;
  /** The TTA-averaged RAW logit vector, CLASS_ORDER-indexed. Null when the image was excluded. */
  logits: number[] | null;
  probs: Record<LesionClass, number> | null;
  topClass: LesionClass | null;
  topConfidence: number | null;
  detectorUsed: boolean;
  refined: boolean;
  inferenceMs: number;
  /** Set when this image contributed nothing (preprocess/inference failure, or a timeout). */
  excludedReason?: string;
};

/** One completed on-device classification pass. All five softmax values are kept. */
export type ClassificationOutput = {
  probs: Record<LesionClass, number>;
  topClass: LesionClass;
  topConfidence: number;
  attempt: 1 | 2;
  modelVersion: string;
  inputSize: number;
  normalization: string;
  /** Post-hoc temperature applied to logits before softmax; recorded so a later T change
   *  doesn't make historical confidences (and the CS/TPS derived from them) un-auditable. */
  temperature: number;
  inferenceMs: number;
  /** True when the predicted class changed across center-crop scales, i.e. the photo's framing
   *  rather than the lesion drove the answer. Handled as an unreadable image, not as risk. */
  scaleUnstable: boolean;
  /** True when a low-confidence full-frame prediction was re-run on a lesion-centered zoom crop
   *  and that zoomed result was adopted (see model-config.ts REFINE_*). */
  refined: boolean;
  /** True when the YOLO detector localized the lesion and the classifier ran on the detector's
   *  canonical crop (training geometry) rather than the full frame. */
  detectorUsed: boolean;

  /* --- multi-image. All optional, so pre-v11 records parse unchanged. --- */
  /** Images actually POOLED into this result (excludes failures). Absent or 1 on legacy records. */
  imageCount?: number;
  /** 'single' when one photo produced the answer; 'logit-mean' when several were pooled. */
  aggregate?: 'single' | 'logit-mean';
  /** Every captured image's own classification, whether or not it was pooled. */
  perImage?: PerImageResult[];
  /** True when confident per-image predictions disagreed — the multi-image analogue of
   *  scaleUnstable. Recorded always; whether it routes is IMAGE_AGREEMENT_CHECK_ENABLED. */
  imageDisagreement?: boolean;
};

/** A fully completed screening: image + questionnaire + classification + triage. */
export type ScreeningRecord = {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Null when the user skipped marking a body location. */
  mark: BodyMark | null;
  /** The primary photo. Invariant: always equals images[0].uri. Kept scalar so every existing
   *  consumer (history rows, result hero, report/PDF) works unchanged. */
  imageUri: string;
  /** 1–3 photos of this lesion. Synthesized as [imageUri] for pre-v11 records. */
  images: ScreeningImage[];
  /** The primary photo's source. Per-image sources live on `images`; mixed sets are legal. */
  source: 'camera' | 'gallery';
  questionnaire: QuestionnaireResponse;
  /** The classification the triage was computed from (final attempt). */
  classification: ClassificationOutput;
  /** First low-confidence pass, preserved for audit when a rescan happened. */
  firstAttempt?: ClassificationOutput;
  triage: TriageResult;

  /** The tracked lesion this screening belongs to. Null only if linkage failed. */
  lesionId: string | null;
  /** The earlier screening of the same lesion this one follows up on. */
  followUpOf?: string;
  /** True when some questionnaire answers were carried forward rather than re-asked. */
  answersCarried?: boolean;
  /** The screening the carried answers came from. */
  answersSourceId?: string;
  userId?: string | null;
};
