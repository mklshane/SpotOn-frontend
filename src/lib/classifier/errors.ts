/** Failure taxonomy for the on-device classifier. Errors never fabricate a triage result. */
export type ClassifierErrorKind =
  | 'model-load'
  | 'preprocess'
  | 'inference'
  | 'invalid-output'
  | 'timeout';

export class ClassifierError extends Error {
  readonly kind: ClassifierErrorKind;

  constructor(kind: ClassifierErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ClassifierError';
    this.kind = kind;
  }
}

/** Narrow an unknown thrown value to a ClassifierError, wrapping foreign errors. */
export function asClassifierError(e: unknown, fallbackKind: ClassifierErrorKind): ClassifierError {
  return e instanceof ClassifierError
    ? e
    : new ClassifierError(fallbackKind, e instanceof Error ? e.message : String(e), e);
}
