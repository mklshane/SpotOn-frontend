import { useEffect, useState } from 'react';

import { getMeta, setMeta } from '@/data/db';

import { useAuth } from './auth';

/**
 * Which body mesh the 3D body map renders. Both meshes are normalised to the same height and
 * centre at load (see body-model.tsx), so a variant is purely a choice of silhouette - every
 * camera, marker and region constant is shared between them.
 */
export type BodyVariant = 'male' | 'female';

export const BODY_VARIANTS: readonly BodyVariant[] = ['male', 'female'];

export function isBodyVariant(value: unknown): value is BodyVariant {
  return value === 'male' || value === 'female';
}

/**
 * The mesh to show when the user has not chosen one.
 *
 * `Sex` has five values and is nullable, but there are only two meshes. Only an explicit "female"
 * selects the female mesh; `intersex`, `other`, `prefer_not_to_say`, an unrecognised value and a
 * profile that has not been completed yet all fall back to the male mesh, which is what every user
 * saw before this setting existed. Anyone the default does not suit can override it in Settings -
 * the point of the override is that the default never has to guess well for those three values.
 */
export function defaultVariantForSex(sex: string | null | undefined): BodyVariant {
  return sex === 'female' ? 'female' : 'male';
}

/** Persisted override key. Null/absent means "follow the profile". */
const KEY = 'body_figure';

export async function readBodyVariantOverride(): Promise<BodyVariant | null> {
  const stored = await getMeta(KEY);
  return isBodyVariant(stored) ? stored : null;
}

/**
 * Mounted viewers subscribe so a change in Settings reaches a body screen that is already open
 * (a tab or a screen further down the stack) without waiting for it to remount.
 */
const listeners = new Set<(variant: BodyVariant | null) => void>();

export async function writeBodyVariantOverride(variant: BodyVariant | null): Promise<void> {
  // setMeta has no delete; the empty string is the "no override" sentinel and fails isBodyVariant.
  await setMeta(KEY, variant ?? '');
  for (const listener of listeners) listener(variant);
}

/**
 * Resolves the mesh to render: an explicit override if one is stored, otherwise the profile
 * default. `ready` stays false until the stored override has been read, so a viewer can avoid
 * building the male mesh and then immediately rebuilding the female one on the first frame.
 */
export function useBodyVariant(): { variant: BodyVariant; override: BodyVariant | null; ready: boolean } {
  const { user } = useAuth();
  const [override, setOverride] = useState<BodyVariant | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const onChange = (v: BodyVariant | null) => {
      if (alive) setOverride(v);
    };
    listeners.add(onChange);
    readBodyVariantOverride()
      .then((v) => {
        if (alive) setOverride(v);
      })
      .catch(() => {
        // A failed read is not worth blocking the body screen over - fall back to the profile.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, []);

  return { variant: override ?? defaultVariantForSex(user?.sex), override, ready };
}
