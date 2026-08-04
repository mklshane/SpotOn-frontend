/**
 * Renders every body glyph to an HTML contact sheet, from the REAL mapping and artwork
 * (src/lib/body-glyphs.ts + src/lib/body-icons.ts, compiled with the project's own tsc).
 *
 * Kept because it is the only fast way to see what the cards will actually look like — shipping a
 * build to a phone to find out took ten minutes a round.
 *
 * Run:  npm run preview:glyphs [outfile.html]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] ?? join(tmpdir(), 'body-glyphs-preview.html');
const tmp = mkdtempSync(join(tmpdir(), 'body-glyphs-'));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/body-glyphs.ts', 'src/lib/body-icons.ts', 'src/lib/body-figure.ts', '--ignoreConfig', '--outDir', tmp, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);

const G = await import(pathToFileURL(join(tmp, 'body-glyphs.js')).href);
const I = await import(pathToFileURL(join(tmp, 'body-icons.js')).href);
const A = await import(pathToFileURL(join(tmp, 'body-figure.js')).href);

const BRAND = '#FF8A4C';
const GHOST = '#FFE1CE'; // backgroundSelected
const MUTED = '#A99C92';
const FIELD = '#FBF0E8';
const CARD = '#FFFFFF';

const KINDS = ['face', 'head-back', 'neck', 'torso-front', 'torso-back', 'shoulder', 'arm',
  'elbow', 'hand', 'hip', 'leg', 'knee', 'foot', 'body'];

/** Mirrors BodyGlyph exactly — same source choice, same fills, same flip. */
function glyph(kind, side = 'left', size = 112) {
  const flip = side === 'right' ? ' transform="translate(48,0) scale(-1,1)"' : '';
  const icon = G.glyphIcon(kind);
  let body;
  if (icon) {
    const fill = kind === 'body' ? MUTED : BRAND;
    body = (I.ICONS[icon] ?? [])
      .map((p) => `<path d="${p.d}" fill="${fill}"${p.evenodd ? ' fill-rule="evenodd"' : ''}/>`)
      .join('');
  } else {
    const art = A.ART[kind];
    const layer = (list, fill) => (list ?? []).map((d) => `<path d="${d}" fill="${fill}"/>`).join('');
    body = layer(art.context, GHOST) + layer(art.main, BRAND) + layer(art.cut, FIELD);
  }
  return `<svg width="${size}" height="${size}" viewBox="${I.ICON_VIEW_BOX}"><g${flip}>${body}</g></svg>`;
}

/** Label each cell with where its artwork comes from, so the mix is auditable at a glance. */
const source = (k) => (G.glyphIcon(k) ? `Health Icons · ${G.glyphIcon(k)}` : 'ours');

const cell = (k) =>
  `<figure class="cell"><div class="art">${glyph(k)}</div>
   <figcaption>${k}<br><small>${source(k)}</small></figcaption></figure>`;

const card = (k) =>
  `<figure class="card"><div class="cardArt">${glyph(k, 'left', 112)}</div>
   <div class="cardMeta"><b>${k}</b><span>Today · ×2</span></div></figure>`;

const sided = (k) =>
  `<figure class="cell"><div class="art pair">${glyph(k, 'left', 84)}${glyph(k, 'right', 84)}</div>
   <figcaption>${k} — left / right</figcaption></figure>`;

writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>SpotOn body glyphs — Health Icons</title>
<style>
  body { margin:0; padding:32px; background:#FFF9F4; color:#211A15;
         font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  h2 { font-size:13px; letter-spacing:.6px; text-transform:uppercase; color:#7C6E64; margin:32px 0 8px; }
  p.n { color:#7C6E64; font-size:12px; margin:0 0 16px; max-width:780px; }
  .grid { display:flex; flex-wrap:wrap; gap:16px; }
  .cell { margin:0; }
  .art { width:148px; height:132px; background:${FIELD}; border-radius:16px;
         display:flex; align-items:center; justify-content:center; }
  .art.pair { gap:4px; }
  figcaption { margin-top:6px; font-size:12px; color:#7C6E64; text-align:center; }
  figcaption small { color:#A99C92; font-size:11px; }
  .card { margin:0; width:148px; background:${CARD}; border-radius:28px; overflow:hidden;
          box-shadow:0 2px 8px rgba(122,74,43,.08); }
  .cardArt { height:132px; background:${FIELD}; display:flex; align-items:center; justify-content:center; }
  .cardMeta { padding:12px; display:flex; flex-direction:column; gap:2px; }
  .cardMeta b { font-size:14px; font-weight:600; }
  .cardMeta span { font-size:12px; color:#A99C92; }
</style>
<h2>Every glyph</h2>
<p class="n">Caption shows the region kind and where its artwork comes from. Health Icons is used
wherever the set has a real match; the rest use our own drawings, because its single generic
<code>joints</code> icon would otherwise render shoulder, elbow, hip and knee identically, and its
<code>spine</code> read as floating vertebrae rather than a back.</p>
<div class="grid">${KINDS.map(cell).join('')}</div>
<h2>Sidedness</h2><div class="grid">${['hand', 'arm', 'leg', 'foot'].map(sided).join('')}</div>
<h2>On the real card</h2><div class="grid">${KINDS.map(card).join('')}</div>
`,
);

console.log(`wrote ${OUT} (${KINDS.length} kinds, ${new Set(KINDS.map(G.glyphIcon)).size} distinct icons)`);
