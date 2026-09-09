// Read-only regression checks: execute the actual pure modules without native dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = { exports: {} }; cache.set(absolute, mod);
  const js = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`)((name) => {
    const target = path.resolve(path.dirname(absolute), name);
    return target.endsWith('.json') ? JSON.parse(fs.readFileSync(target, 'utf8')) : load(target + '.ts');
  }, mod, mod.exports);
  return mod.exports;
}
const catalog = Object.assign({}, ...['fil.json', 'fil-additions.json'].map(f => JSON.parse(fs.readFileSync(path.join(root, 'src/lib/i18n', f)))));
const normalize = s => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const keys = new Set(Object.keys(catalog).map(normalize));
const placeholders = s => (s.match(/\{\{\w+\}\}/g) || []).sort();
for (const [key, value] of Object.entries(catalog)) {
  assert.ok(value.trim(), `Empty translation: ${key}`);
  assert.deepEqual(placeholders(value), placeholders(key), `Placeholder mismatch: ${key}`);
}
let literalCalls = 0;
const missing = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function checkText(text) { if (!keys.has(normalize(text))) missing.push(`${path.relative(root,file)}: ${text}`); }
    function visit(node) {
      if (ts.isCallExpression(node) && ['t','translate'].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        literalCalls++; checkText(node.arguments[0].text);
      }
      // Auth errors and education alt text are translated at their display sites.
      if (file.endsWith('form-validation.ts') && ts.isStringLiteral(node) && /[ .]/.test(node.text) && /^[A-Z]/.test(node.text)) checkText(node.text);
      if (file.endsWith('learn-images.ts') && ts.isPropertyAssignment(node) && node.name.getText(ast) === 'alt' && ts.isStringLiteral(node.initializer)) checkText(node.initializer.text);
      if (/profile\/(privacy|terms)\.tsx$/.test(file) && ts.isJsxText(node)) assert.ok(!/[A-Za-z]{2}/.test(node.text), `Untranslated legal text in ${file}`);
      ts.forEachChild(node, visit);
    } visit(ast);
  }
} scan(path.join(root,'src'));
assert.deepEqual(missing, []);
const core = load('src/lib/i18n/core.ts');
const recommendations = load('src/lib/triage/recommendations.ts');
const { buildReportModel } = load('src/lib/report/summary-report.ts');
const { buildReportHtml } = load('src/lib/report/report-html.ts');
const { getFullNameError } = load('src/lib/form-validation.ts');
const ids = ['evolution','bleeding_nonhealing','irregular_border','spontaneous_bleeding','rough_scaly','larger_7mm','ugly_duckling','persistent_2mo'];
const record = {
  createdAt: '2026-05-13T01:42:00Z', imageUri: 'file:///synthetic.jpg', mark: { region: 'Chest' },
  classification: { topClass: 'MEL', topConfidence: .9, probs: { MEL: .9, BCC:.025, SCC:.025, OTHER:.025, BENIGN:.025 } },
  questionnaire: { answers: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'yes' : 'unsure'])) },
  triage: { tier: 'high', tps: 4, malignantScore: .95, safetyFloorApplied: true, malignantGateApplied: false },
};
const identity = core.localizedCopy({ id:'Yes', value:'No', kind:'Other', title:'Yes', labels:['Yes','No'] });
const error = getFullNameError('');
const original = buildReportModel(record);
core.applyLocale('fil');
assert.equal(core.t(error), 'Ilagay ang buong pangalan mo.');
assert.equal(identity.id,'Yes'); assert.equal(identity.value,'No'); assert.equal(identity.kind,'Other');
assert.equal(identity.title,'Oo'); assert.equal(identity.labels[0],'Oo');
assert.ok(core.t(recommendations.DISCLAIMER).startsWith('Tulong ang SpotOn'));
assert.ok(core.t(recommendations.REPORT_DISCLAIMER).startsWith('Ang buod'));
assert.equal(core.t('  1. Introduction '), '  1. Panimula ');
assert.equal(core.t('Missing message'), 'Missing message');
assert.equal(core.t('{{age}} y/o', {age: 30}), '30 taong gulang');
const filipino = buildReportModel(record, {full_name:'Male', date_of_birth:'1985-03-14', sex:'male',phone:'09123456789'});
assert.equal(filipino.patient.name, 'Male'); // User values are never translated.
assert.equal(filipino.patient.sex, 'Lalaki');
assert.ok(filipino.patient.dobLine.includes('taong gulang'));
assert.equal(filipino.bodyRegion, 'Dibdib'); assert.equal(record.mark.region, 'Chest');
assert.equal(filipino.dateLabel, '13 Mayo 2026');
const lead = filipino.urgencyLead.map(run=>run.text).join('');
assert.ok(lead.startsWith('Batay sa'));
assert.ok(!lead.includes('{{') && !lead.includes('urgency level'));
// A report's language must survive an async asset load while the app changes language.
core.applyLocale('en');
const html = buildReportHtml(filipino, {photo:null,wordmark:null});
assert.ok(html.includes('lang="fil"') && html.includes('Buod ng screening') && html.includes('Hindi sigurado'));
assert.ok(!html.includes('Screening Summary Report'));
assert.equal(core.t(error), error);
assert.equal(core.t(recommendations.DISCLAIMER), recommendations.DISCLAIMER);
assert.equal(identity.title, 'Yes');
assert.equal(buildReportModel(record).urgencyLead.map(run=>run.text).join(''), original.urgencyLead.map(run=>run.text).join(''));
console.log(`PASS: ${Object.keys(catalog).length} messages; ${literalCalls} literal calls; errors, alt text, consent text, placeholders, identifiers, EN/FIL switching, and report language snapshots.`);
