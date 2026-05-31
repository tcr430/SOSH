import * as Sentry from '@sentry/nextjs'
import { config } from '@/lib/config'
import { scrubEvent, IGNORE_ERRORS } from '@/lib/observability/sentry-init-shared'

Sentry.init({
  dsn: config.public.SENTRY_DSN || undefined,
  environment: config.public.SENTRY_ENVIRONMENT || undefined,
  release: config.public.VERCEL_GIT_COMMIT_SHA || undefined,
  tracesSampleRate: 0.05,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  ignoreErrors: [...IGNORE_ERRORS],
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
})
