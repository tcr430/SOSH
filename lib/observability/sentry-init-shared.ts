// Shared constants imported by instrumentation-client.ts, sentry.server.config.ts,
// and sentry.edge.config.ts. Not imported by application code — use scrubEvent
// from sentry-scrub.ts directly where needed.
export { scrubEvent } from './sentry-scrub'

export const IGNORE_ERRORS = [
  // Browser noise — well-documented false positives:
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured with value: <anonymous>',
  'fb_xd_fragment',

  // Next.js control flow — NOT errors:
  'NEXT_REDIRECT',
  'NEXT_HTTP_ERROR_FALLBACK;404',
] as const
