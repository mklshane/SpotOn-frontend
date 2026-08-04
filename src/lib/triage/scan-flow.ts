/**
 * The scan flow's decision logic, as pure functions.
 *
 * These choices used to live inline in quality.tsx and analysis.tsx, where they could only be
 * checked by walking the app by hand. They decide whether a photo is usable, whether to ask for a
 * retake, and where the user goes next — the parts of the flow where being wrong either wastes the
 * user's effort or, worse, reports a triage tier from a photo the model could not read.
 *
 * Zero imports on purpose: like tps-core.ts and aggregate-core.ts, this compiles standalone under
 * scripts/test-scan-flow.mjs (npm run test:flow), so every branch is pinned without a simulator.
 */

/** The three-way readability verdict tps-core produces (Safety Floor / scale / image agreement). */
export type Readability = 'ok' | 'prompt-rescan' | 'apply-floor';

/** What the quality screen knows about the first classification pass. */
export type ReadState = 'pending' | 'ok' | 'unreadable' | 'timeout';

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
 * passed does wait — briefly — because a low-confidence read is the same kind of "this photo won't
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
    // never claim a verdict that hasn't been reached — even though `analyzing` already gates the
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
 * The only branch left is whether the questionnaire still needs asking — it doesn't on a
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
 * the Safety Floor is applied directly instead — the same outcome as the screen's own
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
