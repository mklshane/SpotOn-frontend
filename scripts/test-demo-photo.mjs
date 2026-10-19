/** Development demo routing: a known source alone cannot select the demo model. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(js, file);
};
const { cropTargetsDetectedSpot, registerDemoCrop, takeDemoCrop } = require('../src/lib/classifier/demo-photo.ts');

let passed = 0;
function check(name, condition) {
  if (!condition) throw new Error(name);
  passed++;
}
const spot = { cx: 0.7, cy: 0.7, bw: 0.08, bh: 0.08, conf: 0.9 };
const image = { w: 1000, h: 1000 };
check('verified spot centred in crop selects demo', cropTargetsDetectedSpot([spot], image, { x: 550, y: 550, side: 300 }));
check('another part of the same photo uses standard model', !cropTargetsDetectedSpot([spot], image, { x: 50, y: 50, side: 300 }));
check('spot only at crop edge uses standard model', !cropTargetsDetectedSpot([spot], image, { x: 450, y: 550, side: 300 }));
check('unverified spot uses standard model', !cropTargetsDetectedSpot([{ ...spot, conf: 0.5 }], image, { x: 550, y: 550, side: 300 }));
check('no verified spots uses standard model', !cropTargetsDetectedSpot([], image, { x: 550, y: 550, side: 300 }));
registerDemoCrop('demo-crop');
check('registered crop is accepted once', takeDemoCrop('demo-crop'));
check('same route cannot select demo again', !takeDemoCrop('demo-crop'));
check('unregistered crop uses standard model', !takeDemoCrop('different-crop'));
console.log(`demo photo routing: ${passed} passed, 0 failed`);
