import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { LoadedModel, SetPart } from './classifier/classify';

import { carryForwardAnswers, MAJOR_QUESTIONS, MINOR_QUESTIONS } from './triage/tps-core';
import type {
  Answer,
  BodyMark,
  ClassificationOutput,
  Lesion,
  QuestionId,
  ScreeningImage,
  ScreeningRecord,
} from './triage/types';

export type { BodyMark };

/**
 * The in-flight screening session, carried across the scan flow screens
 * (body → capture → crop → quality → questionnaire → analysis).
 *
 * Classification runs in the background while the user answers the questionnaire:
 * the promise lives in a ref (settling never re-renders the questionnaire) and the
 * analysis screen joins on it via getClassification(). The Safety Floor rescan loop
 * bumps `attempt` and preserves answers, so a retake never costs the user their input.
 */
type ScreeningSessionValue = {
  bodyMark: BodyMark | null;
  setBodyMark: (mark: BodyMark | null) => void;
  imageUri: string | null;
  setImageUri: (uri: string | null) => void;
  source: 'camera' | 'gallery';
  setSource: (source: 'camera' | 'gallery') => void;

  answers: Partial<Record<QuestionId, Answer>>;
  setAnswer: (id: QuestionId, answer: Answer) => void;
  questionnaireComplete: boolean;

  attempt: 1 | 2;
  /** Resolved low-confidence first pass, kept for the audit trail across a rescan. */
  firstAttempt: ClassificationOutput | null;

  /** Kick off background classification for this attempt. Idempotent per attempt. */
  startClassification: (uri: string) => void;
  /** Join on the in-flight (or settled) classification. Throws if never started. */
  getClassification: () => Promise<ClassificationOutput>;
  /** Restart a failed classification against the session image. */
  retryClassification: () => void;
  classificationState: 'idle' | 'running' | 'done' | 'error';

  /** Enter the rescan pass: attempt 1→2, stash the first result, clear the image. Answers untouched. */
  beginRescan: () => void;
  /** Wipe the session (after persisting a record, or when a new flow starts). */
  reset: () => void;

  /** Set when this run is a re-check of an already-tracked lesion. */
  followUp: { lesion: Lesion; priorScreening: ScreeningRecord } | null;
  /**
   * Begin a follow-up: adopt the lesion's body mark and carry forward the answers the follow-up
   * policy permits (tps-core `carryForwardAnswers`).
   */
  startFollowUp: (lesion: Lesion, prior: ScreeningRecord) => void;
  /** The questions this run must actually ask. All 8 for a fresh scan; a subset for a follow-up. */
  questionsToReask: readonly QuestionId[];

  /**
   * True once the user has been shown the low-confidence warning at the quality screen and chose
   * to continue anyway. Analysis then applies the Safety Floor directly rather than prompting for
   * a retake a second time.
   */
  acceptedLowConfidence: boolean;
  acceptLowConfidence: () => void;

  /* --- multi-image capture (1–3 photos of one lesion) --- */
  /** Accepted photos, in capture order. images[0] is the primary. */
  images: ScreeningImage[];
  /** Accept a photo and return its index. Also starts its inference (see enqueueImage). */
  addImage: (img: Omit<ScreeningImage, 'index'>) => number;
  removeImage: (uri: string) => void;
  /**
   * Start inference for one accepted photo. Runs chained (never concurrent — one interpreter), so
   * by the time the user finishes capturing and answering, earlier photos are already done.
   */
  enqueueImage: (uri: string, index: number) => void;
};

const ScreeningSessionContext = createContext<ScreeningSessionValue | undefined>(undefined);

const ALL_QUESTIONS: readonly QuestionId[] = [...MAJOR_QUESTIONS, ...MINOR_QUESTIONS];

export function ScreeningSessionProvider({ children }: { children: React.ReactNode }) {
  const [bodyMark, setBodyMark] = useState<BodyMark | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [source, setSource] = useState<'camera' | 'gallery'>('camera');
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, Answer>>>({});
  const [attempt, setAttempt] = useState<1 | 2>(1);
  const [firstAttempt, setFirstAttempt] = useState<ClassificationOutput | null>(null);
  const [classificationState, setClassificationState] =
    useState<ScreeningSessionValue['classificationState']>('idle');
  const [followUp, setFollowUp] = useState<ScreeningSessionValue['followUp']>(null);
  const [mustAsk, setMustAsk] = useState<readonly QuestionId[]>(ALL_QUESTIONS);
  const [acceptedLowConfidence, setAcceptedLowConfidence] = useState(false);
  const [images, setImages] = useState<ScreeningImage[]>([]);

  // Per-image inference, chained so only one runs at a time (a single native interpreter, and the
  // TTA loop's "one buffer live at a time" invariant). Refs: settling must not re-render the
  // questionnaire, and the analysis screen joins imperatively.
  const partsRef = useRef<{
    attempt: number;
    runs: Map<number, { uri: string; promise: Promise<SetPart> }>;
  }>({ attempt: 1, runs: new Map() });
  const modelRef = useRef<Promise<LoadedModel> | null>(null);

  // The live inference promise + its resolved value. Refs on purpose: settling must not
  // re-render questionnaire consumers, and the analysis screen pulls the promise imperatively.
  const lastOutputRef = useRef<ClassificationOutput | null>(null);

  const setAnswer = useCallback((id: QuestionId, answer: Answer) => {
    setAnswers((prev) => (prev[id] === answer ? prev : { ...prev, [id]: answer }));
  }, []);

  /** Load the interpreter once per session; every image's run awaits the same promise. */
  const loadModel = useCallback(() => {
    if (!modelRef.current) {
      modelRef.current = (async () => {
        const { prepareModel } = await import('./classifier/classify');
        return prepareModel();
      })();
      // A load failure must not poison every later attempt.
      modelRef.current.catch(() => {
        modelRef.current = null;
      });
    }
    return modelRef.current;
  }, []);

  const enqueueImage = useCallback(
    (uri: string, index: number) => {
      const store = partsRef.current;
      if (store.attempt !== attempt) {
        store.attempt = attempt;
        store.runs = new Map();
      }
      // Keyed on (index, uri): a retake reuses the index with a different photo, and joining the
      // previous photo's promise there would classify the image the user just rejected.
      if (store.runs.get(index)?.uri === uri) return; // already running/settled for this exact photo
      setClassificationState('running');

      // Chain onto the previous image so runs never overlap; a failure upstream must not block us.
      const previous = [...store.runs.values()].map((r) => r.promise);
      const promise = (async () => {
        await Promise.allSettled(previous);
        const { classifyImageAt } = await import('./classifier/classify');
        const { model, inputSize } = await loadModel();
        return classifyImageAt(uri, index, model, inputSize, attempt);
      })();
      store.runs.set(index, { uri, promise });
      promise
        .then((part) => setClassificationState(part.result ? 'done' : 'error'))
        .catch((e) => {
          // Log at the failure site — the analysis screen may join much later.
          console.warn('[screening] classification failed', e);
          setClassificationState('error');
        });
    },
    [attempt, loadModel],
  );

  /** Kept for the single-photo path: accept the image and start its inference in one call. */
  const startClassification = useCallback(
    (uri: string) => {
      enqueueImage(uri, 0);
    },
    [enqueueImage],
  );

  const getClassification = useCallback(async () => {
    const store = partsRef.current;
    if (store.runs.size === 0) throw new Error('screening: classification never started');
    const { composeSetResult } = await import('./classifier/classify');
    const settled = await Promise.all([...store.runs.values()].map((r) => r.promise));
    const { inputSize } = await loadModel();
    const out = composeSetResult(settled, attempt, inputSize);
    lastOutputRef.current = out;
    return out;
  }, [attempt, loadModel]);

  const retryClassification = useCallback(() => {
    const uris = images.length ? images.map((i) => i.uri) : imageUri ? [imageUri] : [];
    if (!uris.length) return;
    partsRef.current = { attempt, runs: new Map() }; // drop the failed runs
    uris.forEach((uri, i) => enqueueImage(uri, i));
  }, [images, imageUri, attempt, enqueueImage]);

  const addImage = useCallback<ScreeningSessionValue['addImage']>((img) => {
    let index = 0;
    setImages((prev) => {
      const existing = prev.findIndex((p) => p.uri === img.uri);
      if (existing !== -1) {
        index = prev[existing].index;
        return prev;
      }
      index = prev.length;
      return [...prev, { ...img, index }];
    });
    return index;
  }, []);

  const removeImage = useCallback((uri: string) => {
    // Re-index so images[0] is always the primary and indices stay contiguous.
    setImages((prev) => prev.filter((p) => p.uri !== uri).map((p, i) => ({ ...p, index: i })));
    partsRef.current = { attempt: partsRef.current.attempt, runs: new Map() };
    setClassificationState('idle');
  }, []);

  const acceptLowConfidence = useCallback(() => setAcceptedLowConfidence(true), []);


  const beginRescan = useCallback(() => {
    setFirstAttempt(lastOutputRef.current);
    setAttempt(2);
    setImageUri(null);
    // Every image and every in-flight run must go: leaving them would pool attempt 1's photos with
    // the retake, which is precisely the bug the rescan exists to fix.
    setImages([]);
    setClassificationState('idle');
    partsRef.current = { attempt: 2, runs: new Map() };
    lastOutputRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setBodyMark(null);
    setImageUri(null);
    setSource('camera');
    setAnswers({});
    setAttempt(1);
    setFirstAttempt(null);
    setClassificationState('idle');
    setFollowUp(null);
    setMustAsk(ALL_QUESTIONS);
    setImages([]);
    setAcceptedLowConfidence(false);
    partsRef.current = { attempt: 1, runs: new Map() };
    lastOutputRef.current = null;
  }, []);

  const startFollowUp = useCallback<ScreeningSessionValue['startFollowUp']>((lesion, prior) => {
    // reset() first, deliberately: `attempt` is the Safety Floor's two-strike counter, and a
    // follow-up is a NEW screening. Carrying attempt=2 over would make the second check of any
    // lesion skip the retake prompt and go straight to the Moderate floor on a low-confidence read.
    setBodyMark(null);
    setImageUri(null);
    setSource('camera');
    setAttempt(1);
    setFirstAttempt(null);
    setClassificationState('idle');
    setImages([]);
    setAcceptedLowConfidence(false);
    partsRef.current = { attempt: 1, runs: new Map() };
    lastOutputRef.current = null;

    const daysSincePrior = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(prior.createdAt)) / 86_400_000),
    );
    const { prefilled, mustAsk: ask } = carryForwardAnswers(
      prior.questionnaire.answers,
      { daysSincePrior },
    );
    setFollowUp({ lesion, priorScreening: prior });
    setBodyMark(lesion.mark);
    setAnswers(prefilled);
    setMustAsk(ask);
  }, []);

  const questionnaireComplete = useMemo(
    () => ALL_QUESTIONS.every((q) => answers[q] !== undefined),
    [answers],
  );

  const value = useMemo<ScreeningSessionValue>(
    () => ({
      bodyMark,
      setBodyMark,
      imageUri,
      setImageUri,
      source,
      setSource,
      answers,
      setAnswer,
      questionnaireComplete,
      attempt,
      firstAttempt,
      startClassification,
      getClassification,
      retryClassification,
      classificationState,
      beginRescan,
      reset,
      followUp,
      startFollowUp,
      questionsToReask: mustAsk,
      acceptedLowConfidence,
      acceptLowConfidence,
      images,
      addImage,
      removeImage,
      enqueueImage,
    }),
    [
      bodyMark,
      imageUri,
      source,
      answers,
      setAnswer,
      questionnaireComplete,
      attempt,
      firstAttempt,
      startClassification,
      getClassification,
      retryClassification,
      classificationState,
      beginRescan,
      reset,
      followUp,
      startFollowUp,
      mustAsk,
      acceptedLowConfidence,
      acceptLowConfidence,
      images,
      addImage,
      removeImage,
      enqueueImage,
    ],
  );

  return <ScreeningSessionContext.Provider value={value}>{children}</ScreeningSessionContext.Provider>;
}

export function useScreeningSession(): ScreeningSessionValue {
  const ctx = useContext(ScreeningSessionContext);
  if (!ctx) throw new Error('useScreeningSession must be used within a ScreeningSessionProvider');
  return ctx;
}
