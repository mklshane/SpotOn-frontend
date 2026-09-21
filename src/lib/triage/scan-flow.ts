/**
 * The scan flow's decision logic, as pure functions.
 *
 * These choices used to live inline in quality.tsx and analysis.tsx, where they could only be
 * checked by walking the app by hand. They decide whether a photo is usable, whether to ask for a
 * retake, and where the user goes next - the parts of the flow where being wrong either wastes the
 * user's effort or, worse, reports a triage tier from a photo the model could not read.
 *
 * Zero imports on purpose: like tps-core.ts and aggregate-core.ts, this compiles standalone under
 * scripts/test-scan-flow.mjs (npm run test:flow), so every branch is pinned without a simulator.
 */

/** The three-way readability verdict tps-core produces (Safety Floor / scale / image agreement). */
export type Readability = 'ok' | 'prompt-rescan' | 'apply-floor';

/** What the quality screen knows about the first classification pass. */
export type ReadState = 'pending' | 'ok' | 'unreadable' | 'timeout';

/** The image checks the still gate blocks on, as the quality screen reads them. */
export type IqaTerms = {
  error: boolean;
  brightnessOk: boolean;
  sharpOk: boolean;
  skinOk: boolean;
  presenceOk: boolean;
  /**
   * The learned skin gate's verdict on the still (skin-gate.ts, via skinGateVerdict). 'failed' covers
   * a load/run failure AND a timeout, and blocks: could-not-check is not a pass (2026-09-17).
   */
  skinGate: SkinGateVerdict;
};

/**
 * Is this body-map region the head (scalp, face, hairline)?
 *
 * The region is stored as DISPLAY text, translated at the moment it was picked (body-regions.ts
 * resolves it through t()), so a mark saved in Tagalog reads "Likod ng ulo". Both languages are
 * matched rather than re-deriving the region from the 3-D point.
 *
 * Used for hair: the scalp is where hair is densest and where removing it is most likely to paint
 * over the lesion (synth/eval/HAIR_REMOVAL.md), so the head gets a "part the hair" tip instead of
 * any image processing.
 */
const HEAD_REGIONS = new Set(['Head / Face', 'Back of head', 'Ulo / Mukha', 'Likod ng ulo']);
export function isHeadRegion(region: string | null | undefined): boolean {
  return region != null && HEAD_REGIONS.has(region.trim());
}

/** What the learned skin gate says the still is. */
export type SkinGateVerdict = 'skin' | 'not_skin' | 'face' | 'failed';

/** pSkin below this = not a close-up of skin. See SpotOn-synthetic/synth/skin_gate/SKIN_GATE.md. */
export const SKIN_GATE_MIN = 0.5;
/** pFace at or above this = a whole face, which gets its own "move closer" message. */
export const SKIN_GATE_FACE_MAX = 0.5;

/** The skin gate's softmax -> a verdict. Face is checked first: its message is the actionable one. */
export function skinGateVerdict(p: { skin: number; notSkin: number; face: number }): SkinGateVerdict {
  if (p.face >= SKIN_GATE_FACE_MAX) return 'face';
  if (p.skin < SKIN_GATE_MIN) return 'not_skin';
  return 'skin';
}

export type IqaVerdict = {
  /** True when every blocking image check passed. */
  pass: boolean;
  /** What the third row ("Lesion in frame") reports. */
  lesionRowOk: boolean;
};

/**
 * Does the still pass the image checks?
 *
 * EVERY TERM IS A VETO, AND NO TERM IS WAIVED BY ANY OTHER. That is the whole reason this function
 * exists rather than an expression inside quality.tsx, where it lived when it was wrong.
 *
 * The bug (synth/eval/NONSKIN_GATE.md): the skin check used to be waived whenever the lesion
 * detector fired AND the presence signal passed -
 *
 *     const skinBlocks = !skinOk && !(lesionDet === 'found' && presenceOk);
 *
 * - and both of those are near-constant-true on an arbitrary photograph. The detector was trained
 * only on images containing a lesion, so it has no background class and fires on 88% of
 * lesion-free skin; presence is a centre-surround contrast test that any dark object on a lighter
 * ground satisfies. So a photo that FAILED the skin rule was waived through by the two checks least
 * able to tell it from skin, and photos of a street, a t-shirt and a computer screen reached
 * "Looks great" with all three rows green.
 *
 * `presenceOk` is also not the "Lesion in frame" row on its own: a lesion cannot be in a frame that
 * is not skin, so the row is the conjunction. A green tick on a photo of a street is not a
 * mis-tuned threshold, it is a false statement.
 *
 * THE SCENE-REJECTER IS NOW A MODEL (2026-09-19). `detectorFound` was the only term that
 * rejected photographs of scenes (carpet, wood, a shoe), so it was a required term from 2026-09-08
 * - at a measured cost of one real lesion photo in four or five, because the YOLO detector has no
 * background class and misses real lesions too. It also could not say no to a FACE: on a reported
 * selfie it boxed most of the face at 0.26, and every hand-built term is right that a face is
 * sharp, well-lit skin with dark compact regions on it.
 *
 * `skinGate` replaces it: a small classifier trained on skin close-ups vs textures/scenes vs faces
 * (skin-gate.ts). On the held-out sets it rejects every non-skin frame and both reported selfie
 * frames, and gives back most of the recall the detector veto cost - numbers in
 * SpotOn-synthetic/synth/skin_gate/SKIN_GATE.md. The detector still owns the classifier's CROP
 * (classify.ts); it just no longer vetoes. The hand-built terms stay: `skin` is a cheap backstop,
 * and `presence` still answers the question the model does not - is there a spot on this skin.
 */
export function decideIqa(input: IqaTerms): IqaVerdict {
  const lesionRowOk = input.skinOk && input.presenceOk && input.skinGate === 'skin';
  return {
    lesionRowOk,
    pass: !input.error && input.brightnessOk && input.sharpOk && lesionRowOk,
  };
}

export type QualityVerdict = {
  /** True when the photo may auto-advance. */
  pass: boolean;
  /** True while the screen should keep showing its analyzing state. */
  analyzing: boolean;
};

/**
 * Should the quality screen advance, keep waiting, or show its retake UI?
 *
 * The rule that matters: a photo which already FAILED the image checks never waits on inference.
 * It is showing the retake UI either way, so waiting would only make a "no" slower. A photo that
 * passed does wait - briefly - because a low-confidence read is the same kind of "this photo won't
 * work" verdict as blur, and it belongs here rather than eight questions later.
 *
 * `timeout` deliberately counts as readable. We don't know, and analysis.tsx still applies the
 * Safety Floor, so the worst case degrades to the old behaviour rather than to a false verdict.
 */
export function decideQuality(input: {
  iqaPass: boolean;
  read: ReadState;
  /** True once the IQA rows have finished revealing AND the IQA result has settled. */
  checksSettled: boolean;
}): QualityVerdict {
  const waitingOnRead = input.iqaPass && input.read === 'pending';
  return {
    // `pending` is not a pass. It is also recorded on the screening as `qualityPassed`, so it must
    // never claim a verdict that hasn't been reached - even though `analyzing` already gates the
    // auto-advance.
    pass: input.iqaPass && (input.read === 'ok' || input.read === 'timeout'),
    analyzing: !input.checksSettled || waitingOnRead,
  };
}

/** Where the user goes after accepting a photo. */
export type ScanStep = { kind: 'questionnaire' } | { kind: 'analysis' };

/**
 * Routing after a photo is accepted.
 *
 * One photo per pass, from either source, and no detour: a second photo is offered inline on the
 * quality screen and routes straight back to the camera or picker, so nothing queues and there is
 * no review step to pass through.
 *
 * The only branch left is whether the questionnaire still needs asking - it doesn't on a
 * Safety-Floor rescan, or on a follow-up whose answers were carried forward, and re-asking there
 * would be pure friction.
 */
export function nextStepAfterQuality(input: { questionnaireComplete: boolean }): ScanStep {
  return input.questionnaireComplete ? { kind: 'analysis' } : { kind: 'questionnaire' };
}

export type AnalysisAction =
  | { kind: 'finalize'; applyFloor: boolean }
  | { kind: 'prompt-retake' };

/**
 * What the analysis screen does once the classification and the readability verdict are in.
 *
 * `acceptedLowConfidence` is the one non-obvious input: the user may already have been shown this
 * warning on the quality screen and chosen to continue. Asking a second time after the whole
 * questionnaire is exactly the double-prompt that moving the check earlier was meant to remove, so
 * the Safety Floor is applied directly instead - the same outcome as the screen's own
 * "continue anyway", and it stays recorded in the audit trail either way.
 */
export function decideAnalysis(input: {
  verdict: Readability;
  acceptedLowConfidence: boolean;
}): AnalysisAction {
  if (input.verdict === 'ok') return { kind: 'finalize', applyFloor: false };
  if (input.verdict === 'prompt-rescan' && !input.acceptedLowConfidence) {
    return { kind: 'prompt-retake' };
  }
  return { kind: 'finalize', applyFloor: true };
}
