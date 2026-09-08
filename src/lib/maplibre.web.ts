/**
 * Web entry for the map.
 *
 * The implementation needs JSX, so it lives in `maplibre-web-impl.tsx`; this platform file is
 * plain `.ts` deliberately. Every other web shim in this codebase (`fs.web.ts`, `tflite.web.ts`,
 * `asset-uri.web.ts`, `secure-store.web.ts`) is `.ts` and resolves correctly through the `@/`
 * alias, whereas a `.web.tsx` sibling of a `.ts` module did not — Metro kept picking the native
 * `maplibre.ts`. Keeping the platform file's extension matching the native one avoids that.
 */
export * from './maplibre-web-impl';
