import { z } from 'zod'
import { monthOf, previousPeriod } from './period'
import type { PostFilters } from './load'

// ADR 0031 §4.1, §10.6 — Zod on every route param and search param. The business is NEVER one of them: it is the
// server-side active business. An invalid value falls back to its default (a hand-edited URL shows the default month
// rather than an error page); it is never passed on unchecked.

type RawParams = Record<string, string | string[] | undefined>

const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export const FILTER_PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const
const PLATFORM = z.enum(FILTER_PLATFORMS)
// 'none' is the NULL-account bucket (ADR 0031 §4.4).
const ACCOUNT = z.union([z.literal('none'), z.string().uuid()])
const UUID = z.string().uuid()

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The business-local month that contains `now` (the default view). */
export function currentPeriod(now: string, timezone: string): string {
  return monthOf(now, timezone)
}

export function parsePeriod(raw: RawParams, fallback: string): string {
  const parsed = PERIOD.safeParse(first(raw.month))
  return parsed.success ? parsed.data : fallback
}

/** The picker's options: the current month and the 11 before it, newest first. */
export function monthOptions(current: string, count = 12): string[] {
  const out = [current]
  while (out.length < count) out.push(previousPeriod(out[out.length - 1]))
  return out
}

export function parsePostFilters(raw: RawParams, fallbackPeriod: string): PostFilters {
  const platform = PLATFORM.safeParse(first(raw.platform))
  const accountId = ACCOUNT.safeParse(first(raw.account))
  const campaignId = UUID.safeParse(first(raw.campaign))
  return {
    period: parsePeriod(raw, fallbackPeriod),
    ...(platform.success ? { platform: platform.data } : {}),
    ...(accountId.success ? { accountId: accountId.data } : {}),
    ...(campaignId.success ? { campaignId: campaignId.data } : {}),
  }
}
