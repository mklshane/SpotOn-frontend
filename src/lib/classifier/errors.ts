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

/**
 * Describe a thrown value that is not an Error.
 *
 * The web stack rejects with DOM objects rather than Errors: expo-image-manipulator's web
 * `loadImageAsync` rejects with the HTMLCanvasElement, and LiteRT's script loader rejects with an
 * `Event`. `String(e)` on those yields "[object HTMLCanvasElement]" / "[object Event]", which is
 * exactly the useless text that reached the analysis screen's diagnostic line. Pull out whatever
 * the object actually carries so the failure can be identified.
 */
function describeNonError(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e == null) return String(e);

  if (typeof Event !== 'undefined' && e instanceof Event) {
    const target = e.target as { src?: string; tagName?: string } | null;
    const src = target?.src ? ` src=${target.src}` : '';
    // A failed <script>/<img> load is the common case; the type plus the URL identifies it.
    return `${e.type} event on ${target?.tagName?.toLowerCase() ?? 'unknown'}${src}`;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && e instanceof HTMLCanvasElement) {
    return `canvas failure (${e.width}x${e.height})`;
  }

  const message = (e as { message?: unknown })?.message;
  if (typeof message === 'string' && message) return message;

  try {
    const json = JSON.stringify(e);
    if (json && json !== '{}') return json;
  } catch {
    // Circular or exotic - fall through to the tag.
  }
  return Object.prototype.toString.call(e);
}

/** Narrow an unknown thrown value to a ClassifierError, wrapping foreign errors. */
export function asClassifierError(e: unknown, fallbackKind: ClassifierErrorKind): ClassifierError {
  return e instanceof ClassifierError
    ? e
    : new ClassifierError(fallbackKind, e instanceof Error ? e.message : describeNonError(e), e);
}
