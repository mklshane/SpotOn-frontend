import { createContext, useContext, useMemo, useState } from 'react';

/**
 * Where on the body the lesion is, captured on the 3D body screen.
 * `point` is in the body model's local space (stable across camera moves) so the
 * marker can be re-rendered read-only later (analysis screen). `region` is the
 * human-readable label derived at tap time (e.g. "Left forearm").
 */
export type BodyMark = {
  point: [number, number, number];
  region: string;
  view: 'front' | 'back';
};

/** The in-progress screening, held in memory until the analysis/persistence phase. */
export type ScanDraft = {
  bodyMark: BodyMark | null;
  imageUri: string | null;
};

type ScanDraftContextValue = ScanDraft & {
  setBodyMark: (mark: BodyMark | null) => void;
  setImageUri: (uri: string | null) => void;
  reset: () => void;
};

const ScanDraftContext = createContext<ScanDraftContextValue | undefined>(undefined);

export function ScanDraftProvider({ children }: { children: React.ReactNode }) {
  const [bodyMark, setBodyMark] = useState<BodyMark | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);

  const value = useMemo<ScanDraftContextValue>(
    () => ({
      bodyMark,
      imageUri,
      setBodyMark,
      setImageUri,
      reset: () => {
        setBodyMark(null);
        setImageUri(null);
      },
    }),
    [bodyMark, imageUri],
  );

  return <ScanDraftContext.Provider value={value}>{children}</ScanDraftContext.Provider>;
}

export function useScanDraft(): ScanDraftContextValue {
  const ctx = useContext(ScanDraftContext);
  if (!ctx) throw new Error('useScanDraft must be used within a ScanDraftProvider');
  return ctx;
}
