import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { MAJOR_QUESTIONS, MINOR_QUESTIONS } from './triage/tps-core';
import type { Answer, BodyMark, ClassificationOutput, QuestionId } from './triage/types';

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

  // The live inference promise + its resolved value. Refs on purpose: settling must not
  // re-render questionnaire consumers, and the analysis screen pulls the promise imperatively.
  const runRef = useRef<{ attempt: number; promise: Promise<ClassificationOutput> } | null>(null);
  const lastOutputRef = useRef<ClassificationOutput | null>(null);

  const setAnswer = useCallback((id: QuestionId, answer: Answer) => {
    setAnswers((prev) => (prev[id] === answer ? prev : { ...prev, [id]: answer }));
  }, []);

  const startClassification = useCallback(
    (uri: string) => {
      if (runRef.current?.attempt === attempt) return; // already running/settled for this pass
      setClassificationState('running');
      const promise = (async () => {
        // Lazy import keeps the TFLite module (and its native deps) off the app-startup path.
        const { classifyLesion } = await import('./classifier/classify');
        return classifyLesion(uri, attempt);
      })();
      runRef.current = { attempt, promise };
      promise
        .then((out) => {
          lastOutputRef.current = out;
          setClassificationState('done');
        })
        .catch((e) => {
          // Log at the failure site — the analysis screen may join much later.
          console.warn('[screening] classification failed', e);
          setClassificationState('error');
        });
    },
    [attempt],
  );

  const getClassification = useCallback(() => {
    if (!runRef.current) return Promise.reject(new Error('screening: classification never started'));
    return runRef.current.promise;
  }, []);

  const retryClassification = useCallback(() => {
    if (!imageUri) return;
    runRef.current = null; // drop the failed run so startClassification goes again
    startClassification(imageUri);
  }, [imageUri, startClassification]);

  const beginRescan = useCallback(() => {
    setFirstAttempt(lastOutputRef.current);
    setAttempt(2);
    setImageUri(null);
    setClassificationState('idle');
    runRef.current = null;
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
    runRef.current = null;
    lastOutputRef.current = null;
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
    ],
  );

  return <ScreeningSessionContext.Provider value={value}>{children}</ScreeningSessionContext.Provider>;
}

export function useScreeningSession(): ScreeningSessionValue {
  const ctx = useContext(ScreeningSessionContext);
  if (!ctx) throw new Error('useScreeningSession must be used within a ScreeningSessionProvider');
  return ctx;
}
