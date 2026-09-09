/**
 * Guards the runtime boundary between Reanimated and worklets-core.
 *
 * The app runs two independent worklet runtimes:
 *   - react-native-reanimated (v4, backed by react-native-worklets) drives the UI runtime:
 *     useSharedValue, useAnimatedStyle/Props/Reaction, gesture callbacks.
 *   - react-native-worklets-core drives VisionCamera's frame-processor runtime.
 *
 * Their shared values are NOT interchangeable. Capturing one library's value in the other's
 * worklet makes the converter clone a foreign native mutable, and reading it crashes on a
 * physical device the moment the camera mounts - with no error on a simulator or in Node, which
 * is exactly how it reached a device once already. This test reads the AST instead of waiting
 * for the phone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default ?? traverseModule;

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** Reanimated hooks whose callbacks run on the Reanimated UI runtime. */
const REANIMATED_WORKLET_HOOKS = new Set([
  'useAnimatedStyle',
  'useAnimatedProps',
  'useAnimatedReaction',
  'useDerivedValue',
  'useFrameCallback',
]);
/** VisionCamera hooks whose callbacks run on the worklets-core frame-processor runtime. */
const CORE_WORKLET_HOOKS = new Set(['useFrameProcessor', 'useSkiaFrameProcessor']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** Local names bound to each library's shared-value factory, honouring `as` aliases. */
function sharedValueFactories(ast) {
  const reanimated = new Set();
  const core = new Set();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const target =
      node.source.value === 'react-native-reanimated'
        ? reanimated
        : node.source.value === 'react-native-worklets-core'
          ? core
          : null;
    if (!target) continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.imported.name === 'useSharedValue') {
        target.add(spec.local.name);
      }
    }
  }
  return { reanimated, core };
}

/** Variables initialised from one of `factories`, e.g. `const zoomSV = useSharedValue(1)`. */
function valuesFrom(ast, factories) {
  const names = new Set();
  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (id.type !== 'Identifier' || !init || init.type !== 'CallExpression') return;
      if (init.callee.type === 'Identifier' && factories.has(init.callee.name)) names.add(id.name);
    },
  });
  return names;
}

/** Every identifier referenced anywhere inside the callbacks passed to `hooks`. */
function identifiersInWorkletHooks(ast, hooks) {
  const found = new Map();
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== 'Identifier' || !hooks.has(callee.name)) return;
      path.traverse({
        Identifier(inner) {
          if (!inner.isReferencedIdentifier()) return;
          if (!found.has(inner.node.name)) found.set(inner.node.name, inner.node.loc?.start.line ?? 0);
        },
      });
    },
  });
  return found;
}

const failures = [];
let checked = 0;

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  if (!/useFrameProcessor|useSkiaFrameProcessor|useAnimatedStyle|useAnimatedProps/.test(source)) continue;
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const factories = sharedValueFactories(ast);
  if (factories.reanimated.size === 0 && factories.core.size === 0) continue;
  checked++;

  const reanimatedValues = valuesFrom(ast, factories.reanimated);
  const coreValues = valuesFrom(ast, factories.core);
  const rel = relative(ROOT, file);

  for (const [name, line] of identifiersInWorkletHooks(ast, CORE_WORKLET_HOOKS)) {
    if (reanimatedValues.has(name)) {
      failures.push(
        `${rel}:${line} - frame processor (worklets-core runtime) reads \`${name}\`, ` +
          `a react-native-reanimated shared value. Mirror it into a worklets-core value instead.`,
      );
    }
  }
  for (const [name, line] of identifiersInWorkletHooks(ast, REANIMATED_WORKLET_HOOKS)) {
    if (coreValues.has(name)) {
      failures.push(
        `${rel}:${line} - Reanimated worklet reads \`${name}\`, ` +
          `a react-native-worklets-core shared value. Mirror it into a Reanimated value instead.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('worklet runtimes: ' + failures.length + ' cross-runtime shared value(s)\n');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log(`worklet runtimes: ${checked} file(s) checked, no cross-runtime shared values`);
