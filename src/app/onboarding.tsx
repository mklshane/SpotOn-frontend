import { Redirect } from 'expo-router';

/**
 * `(onboarding)` is a route group, so its index resolves to `/` and is only ever reached via
 * the splash redirect - a literal `/onboarding` URL 404'd on the static web export, which made
 * the first-run carousel untestable without clearing the SQLite `has_seen_onboarding` flag.
 *
 * This alias emits a real `dist/onboarding.html`, so the URL resolves on any host. A catch-all
 * SPA rewrite would have done it too, but that would mask genuine 404s everywhere else.
 */
export default function OnboardingAlias() {
  return <Redirect href="/(onboarding)" />;
}
