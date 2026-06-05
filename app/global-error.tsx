'use client'

import { useEffect, useState } from 'react'
import * as Sentry from '@sentry/nextjs'

const GLOBAL_ERROR_COPY = {
  en: {
    title: 'Something went wrong',
    body: 'An unexpected error occurred. Your data is safe. We have been notified and will investigate.',
    retry: 'Try again',
    home: 'Go home',
    reference: 'Reference',
  },
  pt: {
    title: 'Algo correu mal',
    body: 'Ocorreu um erro inesperado. Os seus dados estão seguros. Fomos notificados e iremos investigar.',
    retry: 'Tentar novamente',
    home: 'Ir para o início',
    reference: 'Referência',
  },
  es: {
    title: 'Algo salió mal',
    body: 'Ocurrió un error inesperado. Sus datos están seguros. Hemos sido notificados y lo investigaremos.',
    retry: 'Intentar de nuevo',
    home: 'Ir al inicio',
    reference: 'Referencia',
  },
} as const

type Locale = keyof typeof GLOBAL_ERROR_COPY

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const segment = window.location.pathname.split('/')[1]
  return Object.hasOwn(GLOBAL_ERROR_COPY, segment) ? (segment as Locale) : 'en'
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const locale = detectLocale()
  const copy = GLOBAL_ERROR_COPY[locale]
  const [eventId, setEventId] = useState<string | undefined>()

  useEffect(() => {
    const id = Sentry.captureException(error)
    setEventId(id)
  }, [error])

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{copy.title}</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          :root {
            --bg: oklch(0.985 0.002 75);
            --ink: oklch(0.145 0.004 75);
            --muted: oklch(0.556 0.005 75);
            --border: oklch(0.922 0.005 75);
            --radius: 0.625rem;
          }
          body {
            background: var(--bg);
            color: var(--ink);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            font-size: 1rem;
            line-height: 1.5;
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
          }
          .wrap {
            width: 100%;
            max-width: 26rem;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
          }
          .brand {
            font-size: 0.8125rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            color: var(--ink);
            text-decoration: none;
          }
          h1 {
            font-size: 1.5rem;
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1.2;
            text-wrap: balance;
          }
          p {
            font-size: 0.9375rem;
            color: var(--muted);
            line-height: 1.65;
            max-width: 48ch;
          }
          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.625rem;
          }
          .btn-primary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 2.25rem;
            padding: 0 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            background: var(--ink);
            color: var(--bg);
            border: none;
            border-radius: var(--radius);
            cursor: pointer;
            transition: opacity 150ms ease-out;
            white-space: nowrap;
          }
          .btn-primary:hover { opacity: 0.8; }
          .btn-secondary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 2.25rem;
            padding: 0 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--ink);
            background: transparent;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            text-decoration: none;
            transition: background 150ms ease-out;
            white-space: nowrap;
          }
          .btn-secondary:hover { background: oklch(0.97 0.002 75); }
          .ref {
            font-size: 0.6875rem;
            color: var(--muted);
            opacity: 0.55;
            font-variant-numeric: tabular-nums;
          }
          @media (prefers-reduced-motion: reduce) {
            .btn-primary, .btn-secondary { transition: none; }
          }
        `}</style>
      </head>
      <body>
        <div className="wrap">
          <a href="/" className="brand">SŌSH</a>
          <div>
            <h1>{copy.title}</h1>
          </div>
          <p>{copy.body}</p>
          <div className="actions">
            <button type="button" className="btn-primary" onClick={reset}>
              {copy.retry}
            </button>
            <a href={`/${locale}`} className="btn-secondary">
              {copy.home}
            </a>
          </div>
          {eventId && (
            <span className="ref">
              {copy.reference}: {eventId}
            </span>
          )}
        </div>
      </body>
    </html>
  )
}
