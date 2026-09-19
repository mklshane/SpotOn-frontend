/**
 * Dependency-free regression test for the still-image quality gate's pure core
 * (src/lib/image-quality-core.ts). Compiles the core with the project's own tsc, then asserts
 * the gate's verdicts on hand-built RGBA buffers - no jest, no native modules, no fixtures.
 *
 * Run:  npm run test:iqa
 *
 * This guards the JS side independently of the Python parity harness in SpotOn-synthetic. The
 * threshold *values* are additionally pinned against this file's constants by that harness's
 * test_iqa_parity.py (which reads image-quality-core.ts directly).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'iqa-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/image-quality-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const core = await import(pathToFileURL(join(out, 'image-quality-core.js')).href);
const { analyzeRgba, hairCoverage, SIZE, BLUR, DIRECTIONAL_BLUR, LESION_EDGE_WIDTH, LESION_PRESENCE, LESION_SIDED_MIN, LESION_HUE_MIN, HAIR_ROI_MAX } = core;

const S = 64;
const buf = (fn) => {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const [r, g, b] = fn(x, y);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  return d;
};
const noise = (x, y) => ((x * 7 + y * 13) % 23) - 11; // deterministic fine texture

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));

// Well-lit, textured skin -> everything ok.
let r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [190 + n, 140 + n, 120 + n]; }), S, S);
check('textured skin: brightness ok', r.brightness.ok);
check('textured skin: skin ok', r.skin.ok);
check('textured skin: sharp ok', r.sharpness.ok);
check('textured skin: pass', r.brightness.ok && r.sharpness.ok && r.skin.ok);

// Too dark.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [(190 + n) * 0.1, (140 + n) * 0.1, (120 + n) * 0.1]; }), S, S);
check('dark: issue is dark', r.brightness.issue === 'dark');
check('dark: brightness not ok', !r.brightness.ok);

// Very bright, but evenly lit and unblown -> NOT a reject. Generic over-exposure was dropped as a
// gate (image-quality-core.ts): only glare ON the lesion costs the classifier anything.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [235 + n * 0.5, 215 + n * 0.5, 205 + n * 0.5]; }), S, S);
check('very bright: mean luma is above the old 0.8 reject', r.brightness.value > 0.8);
check('very bright: issue is ok', r.brightness.issue === 'ok');
check('very bright: brightness ok', r.brightness.ok);

// Central specular glare on skin.
r = analyzeRgba(buf((x, y) => {
  const c = Math.abs(x - S / 2) < S * 0.25 && Math.abs(y - S / 2) < S * 0.25;
  const n = noise(x, y);
  return c ? [255, 255, 255] : [190 + n, 140 + n, 120 + n];
}), S, S);
check('glare: issue is glare', r.brightness.issue === 'glare');
check('glare: brightness not ok', !r.brightness.ok);

// Flat gray wall -> not skin.
r = analyzeRgba(buf(() => [150, 150, 150]), S, S);
check('gray: skin not ok', !r.skin.ok);

// Perfectly flat skin (no texture) reads as blurry.
r = analyzeRgba(buf(() => [190, 140, 120]), S, S);
check('flat skin: sharp not ok', !r.sharpness.ok);

/* ----------------------------------------------------------------- edge width ----------- */
// The focus term that grain cannot fool. Built at 256px rather than the S=64 used above, because
// EDGE_SMOOTH is a fixed 5px: at 64px it spans 8% of the frame and the scale relationships stop
// resembling the 1024px the gate actually runs at.
{
  const E = 256;
  const ebuf = (fn) => {
    const d = new Uint8Array(E * E * 4);
    for (let y = 0; y < E; y++)
      for (let x = 0; x < E; x++) {
        const i = (y * E + x) * 4;
        const [r0, g0, b0] = fn(x, y);
        d[i] = r0; d[i + 1] = g0; d[i + 2] = b0; d[i + 3] = 255;
      }
    return d;
  };
  // Every image here carries `noise` - the deterministic fine texture that stands in for sensor
  // grain, i.e. the thing that used to make a blurred photo measure SHARPER than a sharp one.
  const skin = (x, y, t) => {
    const n = noise(x, y);
    return [90 + 100 * t + n, 60 + 80 * t + n, 50 + 70 * t + n];
  };

  // A hard-edged dark lesion: its contrast completes in ~1px.
  let e = analyzeRgba(ebuf((x, y) => skin(x, y, Math.hypot(x - E / 2, y - E / 2) < E * 0.12 ? 0 : 1)), E, E);
  check('hard-edged lesion: focus ok', e.sharpness.ok);
  check('hard-edged lesion: edge width small', e.sharpness.edgeWidth < 6);

  // The same lesion with its edge ramped out over a quarter of the frame - defocus, nothing else.
  const ramped = ebuf((x, y) => {
    const d = Math.hypot(x - E / 2, y - E / 2) / E;
    return skin(x, y, Math.min(1, Math.max(0, (d - 0.05) / 0.28)));
  });
  e = analyzeRgba(ramped, E, E);
  check('defocused lesion: edge width large', e.sharpness.edgeWidth > LESION_EDGE_WIDTH);
  check('defocused lesion: focus NOT ok', !e.sharpness.ok);
  // The regression this term exists for: with grain present, the two older terms call the
  // defocused image sharp - the Laplacian is reading the noise, not the lesion.
  check(
    'defocused lesion: the OLD terms alone still pass it (this is the bug)',
    e.sharpness.value >= BLUR && e.sharpness.directional >= DIRECTIONAL_BLUR,
  );

  // A limb edge against a background is not a lesion, however strong the contrast across it. This
  // is the reported bug: the ring test averages the surround, so an edge whose ring is bright skin
  // on one side and dark room on the other still scores high - sidedness is what says no.
  e = analyzeRgba(ebuf((x, y) => {
    const n = noise(x, y);
    const limb = x < E * 0.72 + E * 0.06 * Math.sin((Math.PI * y) / E);
    return limb ? [190 + n, 140 + n, 120 + n] : [30 + n, 30 + n, 32 + n];
  }), E, E);
  check('limb edge: ring contrast is high', e.lesion.score > LESION_PRESENCE);
  check('limb edge: sidedness is low', e.lesion.sided < LESION_SIDED_MIN);
  check('limb edge: NOT a lesion', !e.lesion.ok);

  // The same skin with a real lesion on it stays a lesion: it is darker on every side.
  e = analyzeRgba(ebuf((x, y) => {
    const n = noise(x, y);
    const limb = x < E * 0.72 + E * 0.06 * Math.sin((Math.PI * y) / E);
    if (!limb) return [30 + n, 30 + n, 32 + n];
    return Math.hypot(x - E * 0.42, y - E / 2) < E * 0.1 ? [90 + n, 60 + n, 50 + n] : [190 + n, 140 + n, 120 + n];
  }), E, E);
  check('lesion beside a limb edge: still detected', e.lesion.ok);

  // A one-sided shading gradient is not a lesion either.
  e = analyzeRgba(ebuf((x, y) => {
    const n = noise(x, y);
    const f = 1 - (x / E) * 0.55;
    return [(190 + n) * f, (140 + n) * f, (120 + n) * f];
  }), E, E);
  check('shading gradient: NOT a lesion', !e.lesion.ok);

  // A photo with no lesion has no edge to measure: the term must abstain, not reject.
  e = analyzeRgba(ebuf((x, y) => skin(x, y, 1)), E, E);
  check('bare skin: edge width abstains', e.sharpness.edgeWidth <= LESION_EDGE_WIDTH && e.sharpness.ok);
}

/* ------------------------------------------------ edge width vs the auto-zoom (2026-09-19) - */
// The other direction from the 2026-09-09 report: a genuinely SHARP lesion that crop.tsx enlarges
// 2.28x must still pass - on the image as analysed, since the gate no longer divides by the upscale.
// And the same scene defocused before that enlargement must not.
{
  const C = 450; // crop.tsx's cropSize in the 09-09 log; enlarged to OUTPUT like the app does
  const O = SIZE;
  const scene = (x, y) => {
    const n = noise(x, y);
    const t = Math.hypot(x - C / 2, y - C / 2) < C * 0.12 ? 0 : 1;
    return [90 + 100 * t + n, 60 + 80 * t + n, 50 + 70 * t + n];
  };
  const defocus = (src, r) => {
    // Three box passes ~ a gaussian, per channel - the optics, applied before the enlargement.
    let a = src;
    for (let pass = 0; pass < 3; pass++) {
      const out = new Float32Array(a.length);
      for (let y = 0; y < C; y++)
        for (let x = 0; x < C; x++)
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let d = -r; d <= r; d++) s += a[(y * C + Math.min(C - 1, Math.max(0, x + d))) * 3 + c];
            out[(y * C + x) * 3 + c] = s / (2 * r + 1);
          }
      const out2 = new Float32Array(a.length);
      for (let y = 0; y < C; y++)
        for (let x = 0; x < C; x++)
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let d = -r; d <= r; d++) s += out[(Math.min(C - 1, Math.max(0, y + d)) * C + x) * 3 + c];
            out2[(y * C + x) * 3 + c] = s / (2 * r + 1);
          }
      a = out2;
    }
    return a;
  };
  const upscale = (src) => {
    // Bilinear, which is the softest thing the app's resamplers do - a fair worst case for "sharp".
    const d = new Uint8Array(O * O * 4);
    const k = C / O;
    for (let y = 0; y < O; y++)
      for (let x = 0; x < O; x++) {
        const sx = Math.min(C - 1, Math.max(0, (x + 0.5) * k - 0.5));
        const sy = Math.min(C - 1, Math.max(0, (y + 0.5) * k - 0.5));
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(C - 1, x0 + 1), y1 = Math.min(C - 1, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        for (let c = 0; c < 3; c++) {
          const v = (px, py) => src[(py * C + px) * 3 + c];
          const top = v(x0, y0) * (1 - fx) + v(x1, y0) * fx;
          const bot = v(x0, y1) * (1 - fx) + v(x1, y1) * fx;
          d[(y * O + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(top * (1 - fy) + bot * fy)));
        }
        d[(y * O + x) * 4 + 3] = 255;
      }
    return d;
  };
  const sharp = new Float32Array(C * C * 3);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) sharp.set(scene(x, y), (y * C + x) * 3);

  let z = analyzeRgba(upscale(sharp), O, O);
  check(`sharp lesion enlarged 2.28x: focus ok (edgeWidth ${z.sharpness.edgeWidth.toFixed(1)})`, z.sharpness.ok);
  z = analyzeRgba(upscale(defocus(sharp, 4)), O, O);
  check(
    `defocused lesion enlarged 2.28x: focus NOT ok (edgeWidth ${z.sharpness.edgeWidth.toFixed(1)})`,
    !z.sharpness.ok && z.sharpness.edgeWidth > LESION_EDGE_WIDTH,
  );
}

/* ------------------------------------ the defocused close-up that passed (2026-09-19) ------ */
// A real capture, reported with all three rows green: a defocused, red-and-white close-up taken
// with the phone too near the subject. The old edge width divided the lesion blob's contrast (55)
// by a slope borrowed from much brighter bokeh highlights, got ~20, and the auto-zoom's upscale
// divided that under the bar. The fixture is the photo as the result screen displayed it, resized
// back to SIZE².
{
  const jpeg = (await import(pathToFileURL(join(ROOT, 'node_modules/jpeg-js/index.js')).href)).default;
  const img = jpeg.decode(readFileSync(join(ROOT, 'scripts/fixtures/iqa-defocused-closeup-2026-09-19.jpg')), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const f = analyzeRgba(img.data, img.width, img.height);
  // Preconditions: nothing else on the screen could have caught it, so focus has to.
  check('defocused close-up: exposure passes (precondition)', f.brightness.ok);
  check('defocused close-up: skin passes (precondition)', f.skin.ok);
  check('defocused close-up: lesion passes (precondition)', f.lesion.ok);
  check(
    `defocused close-up: edge width over the bar (${f.sharpness.edgeWidth.toFixed(1)} > ${LESION_EDGE_WIDTH})`,
    f.sharpness.edgeWidth > LESION_EDGE_WIDTH,
  );
  check('defocused close-up: focus NOT ok', !f.sharpness.ok);
}

/* ------------------------------------------------------------- lesion presence ---------- */
// The row this drives ("Lesion in frame") used to be the YOLO detector's verdict, which fires on
// bare skin ~88% of the time. These pin the replacement signal's two ends.

// Bare textured skin, no lesion -> nothing to find.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); return [190 + n, 140 + n, 120 + n]; }), S, S);
check('bare skin: lesion not ok', !r.lesion.ok);

// The same skin with a dark central blob ~20% of the frame -> present.
const blob = (rr, gg, bb) => buf((x, y) => {
  const n = noise(x, y);
  const d = Math.hypot(x - S / 2, y - S / 2) < S * 0.1;
  return d ? [rr + n, gg + n, bb + n] : [190 + n, 140 + n, 120 + n];
});
r = analyzeRgba(blob(90, 60, 50), S, S);
check('dark blob: lesion ok', r.lesion.ok);

// Redder-than-skin blob at the SAME luminance - the g−r channel is what catches inflamed lesions.
r = analyzeRgba(blob(215, 118, 108), S, S);
check('red blob: lesion ok', r.lesion.ok);

// A blob out at the frame edge is not the spot the user framed.
r = analyzeRgba(buf((x, y) => {
  const n = noise(x, y);
  const d = Math.hypot(x - S * 0.06, y - S * 0.06) < S * 0.05;
  return d ? [90 + n, 60 + n, 50 + n] : [190 + n, 140 + n, 120 + n];
}), S, S);
check('off-frame blob: lesion not ok', !r.lesion.ok);

/* ------------------------------------------------------- a photo of the world ----------- */
// The failure SKIN_MIN was raised for: presence answers "is there a compact dark blob", and an
// ordinary photograph answers yes. Only the skin fraction can tell these from a lesion close-up.
{
  const W = 256;
  const wbuf = (fn) => {
    const d = new Uint8Array(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const [r0, g0, b0] = fn(x, y);
        d[i] = r0; d[i + 1] = g0; d[i + 2] = b0; d[i + 3] = 255;
      }
    return d;
  };
  // A navy t-shirt filling the lower half, pale neck above. A clean half-plane like this does not
  // fool sidedness (round 2 handles edges), but the REAL photo did: it scored presence 63.7 and
  // sidedness 53.8, against bars of 16 and 11, because a neckline is bounded on every side. What
  // holds in both cases - and what this pins - is that the frame is not mostly skin.
  const shirt = analyzeRgba(wbuf((x, y) => {
    const n = noise(x, y);
    const disc = Math.hypot(x - W * 0.5, y - W * 0.62) < W * 0.22;
    return disc ? [42 + n, 52 + n, 78 + n] : [214 + n, 176 + n, 158 + n];
  }), W, W);
  check('navy blob: shape tests are fooled', shirt.lesion.score >= LESION_PRESENCE && shirt.lesion.sided >= LESION_SIDED_MIN);
  check(`navy blob: hue ${shirt.lesion.hue.toFixed(0)} is below LESION_HUE_MIN`, shirt.lesion.hue < LESION_HUE_MIN);
  check('navy blob: NOT a lesion', !shirt.lesion.ok);

  // The same shape in a colour a lesion can actually be must still pass.
  const brown = analyzeRgba(wbuf((x, y) => {
    const n = noise(x, y);
    const disc = Math.hypot(x - W * 0.5, y - W * 0.62) < W * 0.22;
    return disc ? [96 + n, 62 + n, 48 + n] : [214 + n, 176 + n, 158 + n];
  }), W, W);
  check('brown blob of the same shape: IS a lesion', brown.lesion.ok);

  // A real close-up: skin everywhere, a lesion in the middle.
  const closeup = analyzeRgba(wbuf((x, y) => {
    const n = noise(x, y);
    return Math.hypot(x - W / 2, y - W / 2) < W * 0.13 ? [90 + n, 60 + n, 50 + n] : [214 + n, 176 + n, 158 + n];
  }), W, W);
  check('lesion close-up: skin ok at the raised bar', closeup.skin.ok);
  check('lesion close-up: gate says yes', closeup.skin.ok && closeup.lesion.ok);
}

// A one-sided luminance ramp (shadow) must NOT block the pass - shadow is advisory.
r = analyzeRgba(buf((x, y) => { const n = noise(x, y); const f = 1 - (x / S) * 0.5; return [(190 + n) * f, (140 + n) * f, (120 + n) * f]; }), S, S);
check('shadow advisory: still passes exposure+focus+skin', r.brightness.ok && r.sharpness.ok && r.skin.ok);

/* --------------------------------------------------------------------- hair -------------- */
// Advisory hair detection. Built at 256px for the same reason the edge-width block is: HAIR_HAT_RADIUS
// and HAIR_COH_RADIUS are fixed pixel radii, so at S=64 they span a quarter of the frame and the
// scale relationships stop resembling the 1024px the gate runs at.
{
  const N = 256;
  const gray = (fn) => {
    const g = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g[y * N + x] = fn(x, y);
    return g;
  };
  const skin = (x, y) => 150 + (((x * 7 + y * 13) % 23) - 11) * 0.3;
  const strands = (n) => (x, y) => {
    for (let i = 0; i < n; i++) {
      const y0 = (i * 97) % N;
      const y1 = (i * 53 + 31) % N;
      const yy = Math.round(y0 + ((y1 - y0) * x) / (N - 1));
      if (Math.abs(y - yy) <= 1) return 45;
    }
    return skin(x, y);
  };
  const inBlob = (x, y) => (x - N / 2) ** 2 + (y - N / 2) ** 2 < (N / 5) ** 2;

  const bare = hairCoverage(gray(skin), N, N);
  check(`bare skin reads as no hair (${(bare * 100).toFixed(2)}%)`, bare <= HAIR_ROI_MAX);

  const hairy = hairCoverage(gray(strands(20)), N, N);
  check(`strands read as hair (${(hairy * 100).toFixed(2)}%)`, hairy > HAIR_ROI_MAX);

  // The discriminator that forced a morphological closing rather than a box mean: a lesion is dark
  // too, and its RIM is strongly oriented. A box mean scored a plain blob ABOVE real strands.
  const blob = hairCoverage(gray((x, y) => (inBlob(x, y) ? 80 : skin(x, y))), N, N);
  check(`a dark lesion is not hair (${(blob * 100).toFixed(2)}%)`, blob <= HAIR_ROI_MAX);
  check('a dark lesion scores below strands', blob < hairy);

  // The case the feature exists for: hair ACROSS the lesion, not beside it.
  const over = hairCoverage(gray((x, y) => {
    const v = strands(20)(x, y);
    return v === 45 ? 45 : inBlob(x, y) ? 80 : v;
  }), N, N);
  check(`hair over a lesion still reads as hair (${(over * 100).toFixed(2)}%)`, over > HAIR_ROI_MAX);

  // Advisory: it must never move the pass/fail verdict, exactly like shadow.
  const hairyRgba = buf((x, y) => {
    const n = noise(x, y);
    const onHair = (x + y) % 9 === 0;
    return onHair ? [50, 45, 42] : [190 + n, 140 + n, 120 + n];
  });
  const rh = analyzeRgba(hairyRgba, S, S);
  check('hair is reported', typeof rh.hair.coverage === 'number');
  check('hair does not block brightness', rh.brightness.ok);
  check('hair does not block skin', rh.skin.ok);
}

/* ---------------------------------------------------------- cross-file coupling ---------- */
// image-quality.ts skips the manipulateAsync re-encode when the source is already SIZE x SIZE,
// which is true for real traffic only because crop.tsx emits exactly OUTPUT = SIZE. If either
// value moves independently the gate silently falls back to the slow path - still CORRECT, but the
// saved JPEG encode quietly disappears and nothing else would notice. Pin the relationship.
{
  const cropSrc = readFileSync(join(ROOT, 'src/app/scan/crop.tsx'), 'utf8');
  const m = /const OUTPUT = (\d+)/.exec(cropSrc);
  check('crop.tsx declares OUTPUT', m != null);
  if (m) {
    check(
      `crop OUTPUT (${m[1]}) === image-quality SIZE (${SIZE}) - keeps the no-re-encode fast path live`,
      Number(m[1]) === SIZE,
    );
  }
}


if (fails.length) {
  console.error(`\nimage-quality core: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`image-quality core: ${pass} passed, 0 failed`);
