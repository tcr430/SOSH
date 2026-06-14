import * as Sentry from '@sentry/nextjs'
import { scrubEvent, IGNORE_ERRORS } from '@/lib/observability/sentry-init-shared'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
  integrations: [Sentry.replayIntegration()],
  tracesSampleRate: 0.05,
  enableLogs: true,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  ignoreErrors: [...IGNORE_ERRORS],
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
