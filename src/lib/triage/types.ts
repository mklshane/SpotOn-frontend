/**
 * Shared domain types for the post-capture screening workflow.
 * The scoring primitives live in tps-core.ts (kept import-free for the node harness);
 * this module re-exports them and adds the app-level record shapes.
 */
import type { Answer, LesionClass, QuestionId, TriageResult } from './tps-core';

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
};

/** A fully completed screening: image + questionnaire + classification + triage. */
export type ScreeningRecord = {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Null when the user skipped marking a body location. */
  mark: BodyMark | null;
  imageUri: string;
  source: 'camera' | 'gallery';
  questionnaire: QuestionnaireResponse;
  /** The classification the triage was computed from (final attempt). */
  classification: ClassificationOutput;
  /** First low-confidence pass, preserved for audit when a rescan happened. */
  firstAttempt?: ClassificationOutput;
  triage: TriageResult;
};
