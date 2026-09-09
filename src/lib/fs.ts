/**
 * Filesystem access.
 *
 * Native re-exports `expo-file-system/legacy` verbatim, so device behaviour is unchanged and
 * this indirection costs nothing. The web build resolves `fs.web.ts` instead, which reimplements
 * the same surface over OPFS - `expo-file-system` itself is a warn-stub on web (its
 * documentDirectory/cacheDirectory are null and it has no methods at all).
 *
 * Import from here rather than from expo-file-system directly, or the web build will silently
 * no-op instead of storing anything.
 */
export {
  cacheDirectory,
  documentDirectory,
  copyAsync,
  deleteAsync,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
