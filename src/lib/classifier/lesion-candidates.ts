import { isDebug } from '@/lib/debug-flag';
import { lastFastDecoder, transformToRgbaFast } from '@/lib/image-ops';
import { detectFacesInTensor, getFaceModel } from '@/lib/face-model';
import { perfLog } from '@/lib/perf-log';
import { getSkinGateModel, readSkinGateLayout, skinGateOfTensor } from '@/lib/skin-gate';
import { getSpotVerifier, lesionProbability, SPOT_VERIFIER_INPUT } from '@/lib/spot-verifier';

import { scanLesionBlobs } from './blob-core';
import { findSpots, type LesionCandidate, WORK_SHORT } from './candidate-core';
import { detectorInputSize, detectTensor } from './lesion-detector';

export type { LesionCandidate } from './candidate-core';

/**
 * Detector runs stop starting this long after the search began, so a slow phone still finishes
 * well inside crop.tsx's timeout with the spots verified so far. An iPhone finishes in 1-3 s and
 * never reaches it.
 */
export const SEARCH_BUDGET_MS = 3500;

/**
 * A plain-text report of the most recent search - timings and every proposal's scores - for the
 * hidden diagnostics panel in scan/crop.tsx (long-press the header). Release builds send no logs
 * anywhere a tester can reach, so this is how a device run gets reported. Never alters results.
 */
let lastReport = '';
export function lastSpotSearchReport(): string {
  return lastReport;
}

/**
 * Every lesion the multi-spot picker should offer in an uploaded photo, most confident first, as
 * detector boxes in fractions of the image (empty when none is found). See candidate-core.ts for
 * how spots are proposed and verified.
 *
 * `size` is the photo's true pixel size (crop.tsx's, which is right on Android where getSize is
 * not); only its aspect and short side are used here. One decode at WORK_SHORT, then ~13 detector
 * runs on the shared interpreter and a few skin-gate runs per spot found.
 */
export async function findLesionCandidates(
  uri: string,
  size: { w: number; h: number },
): Promise<{ spots: LesionCandidate[]; fallback?: LesionCandidate }> {
  const t0 = Date.now();
  const short = Math.min(size.w, size.h);
  const resize =
    short > WORK_SHORT
      ? [{ resize: size.w <= size.h ? { width: WORK_SHORT } : { height: WORK_SHORT } }]
      : [];
  const img = await transformToRgbaFast(uri, resize);
  const tDecode = Date.now() - t0;
  const detectorSize = await detectorInputSize();
  // The skin gate drops non-skin objects and whole faces the detector mistakes for lesions. Optional: if it
  // cannot load, the search still runs on the detector alone.
  const skin = await getSkinGateModel().catch(() => null);
  // The face detector drops eyes on portraits. Optional in the same way.
  const face = await getFaceModel().catch(() => null);
  // The spot verifier judges each proposal. If it cannot load, findSpots falls back to the
  // detector's confidence (SPOT_SETTINGS.judge needs models.verify).
  const verifier = await getSpotVerifier().catch(() => null);
  // Per-model call counts and time, for the perf log (models run one after another, so these add up).
  const cost: Record<string, [number, number]> = {};
  const timed = <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) => async (...a: A) => {
    const t = Date.now();
    try {
      return await fn(...a);
    } finally {
      const c = (cost[name] ??= [0, 0]);
      c[0]++;
      c[1] += Date.now() - t;
    }
  };
  const tModels = Date.now();
  const r = await findSpots(img, {
    scan: (...a: Parameters<typeof scanLesionBlobs>) => {
      const t = Date.now();
      try {
        return scanLesionBlobs(...a);
      } finally {
        const c = (cost.scan ??= [0, 0]);
        c[0]++;
        c[1] += Date.now() - t;
      }
    },
    detect: timed('detector', detectTensor),
    detectorSize,
    skinGate: skin ? timed('skin', skinGateOfTensor) : undefined,
    skinSize: skin ? readSkinGateLayout(skin) : undefined,
    faceDetect: face ? timed('face', detectFacesInTensor) : undefined,
    verify: verifier ? timed('verifier', lesionProbability) : undefined,
    verifierSize: verifier ? SPOT_VERIFIER_INPUT : undefined,
    deadline: t0 + SEARCH_BUDGET_MS,
    now: Date.now,
  });
  const timing =
    `decode ${tDecode}ms (${lastFastDecoder}), models loaded in ${tModels - t0 - tDecode}ms, ` +
    Object.entries(cost).map(([k, [n, ms]]) => `${k} ${n}x/${ms}ms`).join(', ') +
    `, other JS (downscale, crops) ${Date.now() - tModels - Object.values(cost).reduce((a, [, ms]) => a + ms, 0)}ms` +
    `, ${r.proposals} proposals -> ${r.spots.length} spots` +
    (r.budgetHit ? ` (time budget hit: detector stopped at ${SEARCH_BUDGET_MS}ms)` : '');
  perfLog('candidates.find', Date.now() - t0, timing);
  lastReport = [
    `total ${Date.now() - t0}ms | ${img.width}x${img.height}`,
    timing,
    'proposals (x,y size det verifier):',
    ...r.checked.map((c) => `  ${c.cx.toFixed(2)},${c.cy.toFixed(2)} s${c.size.toFixed(2)} d${c.conf.toFixed(2)} v${c.pLesion.toFixed(2)}`),
    'spots: ' + r.spots.map((c) => `${c.cx.toFixed(2)},${c.cy.toFixed(2)} ${Math.max(c.bw, c.bh).toFixed(2)}`).join(' | '),
    r.fallback ? `no spot -> framing whole-photo box ${r.fallback.cx.toFixed(2)},${r.fallback.cy.toFixed(2)} ${Math.max(r.fallback.bw, r.fallback.bh).toFixed(2)} (det ${r.fallback.conf.toFixed(2)})` : '',
  ].join('\n');
  if (isDebug()) {
    // Why each proposal was kept or dropped: detector conf (-1 = not run), verifier P(lesion).
    console.log(
      '[candidates]',
      r.checked.map((c) => `(${c.cx.toFixed(2)},${c.cy.toFixed(2)}) s${c.size.toFixed(2)} det${c.conf.toFixed(2)} v${c.pLesion.toFixed(2)}`).join(' '),
      '-> spots',
      r.spots.map((c) => `(${c.cx.toFixed(2)},${c.cy.toFixed(2)}) ${Math.max(c.bw, c.bh).toFixed(2)}`).join(' '),
    );
  }
  return { spots: r.spots, fallback: r.fallback };
}
