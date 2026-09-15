'use client'

// ADR 0025 §10.1 (Session 32 I2.14) — "a dismissible dashboard banner links
// back while a run awaits ratification." Dismissal is per-browser
// (localStorage), not persisted server-side — reappears in a new
// browser/session, which is acceptable for a "you left something behind"
// nudge and avoids a new column/table for a single boolean.

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

// Per-storageKey external store so dismissal state is read without a
// synchronous setState in an effect (that pattern triggers a cascading-render
// lint error — Session 32-D BLOCKER-2). getServerSnapshot always reports
// "dismissed" so the server render and the first client render match (no
// hydration mismatch); useSyncExternalStore then reconciles to the real
// localStorage value itself, outside our render/effect cycle.
function createDismissalStore(storageKey: string) {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot(): boolean {
      try {
        return localStorage.getItem(storageKey) === '1'
      } catch {
        return false
      }
    },
    getServerSnapshot(): boolean {
      return true
    },
    dismiss() {
      try {
        localStorage.setItem(storageKey, '1')
      } catch {
        // best-effort only
      }
      listeners.forEach((listener) => listener())
    },
  }
}

export function BackfillBanner({ locale, runId }: { locale: string; runId: string }) {
  const t = useTranslations('onboarding.backfill')
  const storageKey = `backfill-banner-dismissed-${runId}`
  const store = useMemo(() => createDismissalStore(storageKey), [storageKey])
  const dismissed = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)

  if (dismissed) return null

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-muted/40 px-4 py-2 text-sm">
      <Link href={`/${locale}/onboarding/step-4`} className="underline underline-offset-4">
        {t('banner.link')}
      </Link>
      <button
        type="button"
        aria-label={t('banner.dismiss')}
        onClick={() => store.dismiss()}
        className="text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
