import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { runOutcomeTick, type OutcomeTickSummary } from '@/lib/outcomes/orchestrator'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ADR 0026 §14 — the extract-outcomes tick: its own daily deterministic worker (never folded into
// sync-metrics or lib/learning). Dual-mode auth copied from capture-learning: QStash-signed POST, or the
// bearer-secret GET.
async function extractOutcomesTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'extract-outcomes',
        trigger: 'qstash',
        reason: e instanceof QStashAuthError ? e.reason : 'unknown',
      }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  } else {
    const isProd = config.public.NODE_ENV === 'production'
    const authHeader = request.headers.get('authorization') ?? ''
    const devTrigger = request.headers.get('x-cron-dev-trigger') === 'true'

    let authorised = false
    if (isProd) {
      const expected = `Bearer ${config.server.CRON_SECRET}`
      const a = Buffer.from(authHeader)
      const b = Buffer.from(expected)
      if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
    } else {
      const secret = config.server.CRON_SECRET ?? ''
      if (secret) {
        const expected = `Bearer ${secret}`
        const a = Buffer.from(authHeader)
        const b = Buffer.from(expected)
        if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
      }
      if (devTrigger) authorised = true
    }

    if (!authorised) {
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'extract-outcomes', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  const startedAt = Date.now()
  // null = the tick threw before it could report. runOutcomeTick absorbs almost everything itself, so a throw
  // here is catastrophic (a serverOnly()/config failure, a module-load failure, a withMonitor failure) and the
  // counters it reached are UNKNOWN — never zero (MINOR-2).
  let outcomes: OutcomeTickSummary | null = null
  try {
    outcomes = await runOutcomeTick({ triggeredBy })
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: 'route' } })
  }

  // The ONE canonical structured-JSON line (CLAUDE.md worker carve-out). EXACTLY ADR 0026 §14's keys, picked
  // by name so nothing else can leak in: no content, no business id, no hypothesis text. When the tick threw,
  // every counter it did not report is `null` (unknown) rather than a fabricated 0 that would assert "nothing was
  // due and nothing was written"; `errors` is 1 because the throw itself is the error.
  console.log(JSON.stringify({
    kind: 'outcome.tick',
    triggeredBy: outcomes?.triggeredBy ?? triggeredBy,
    tick: outcomes?.tick ?? formatISO(new Date()),
    durationMs: outcomes?.durationMs ?? Date.now() - startedAt,
    candidates: outcomes?.candidates ?? null,
    matured: outcomes?.matured ?? null,
    outcomesWritten: outcomes?.outcomesWritten ?? null,
    skippedNoMetrics: outcomes?.skippedNoMetrics ?? null,
    skippedNeverSynced: outcomes?.skippedNeverSynced ?? null,
    skippedNoBaseline: outcomes?.skippedNoBaseline ?? null,
    skippedIneligibleField: outcomes?.skippedIneligibleField ?? null,
    cellsRecomputed: outcomes?.cellsRecomputed ?? null,
    candidatesUpserted: outcomes?.candidatesUpserted ?? null,
    promoted: outcomes?.promoted ?? null,
    demoted: outcomes?.demoted ?? null,
    retrospectivesCompleted: outcomes?.retrospectivesCompleted ?? null,
    errors: outcomes?.errors ?? 1,
  }))

  // Always 200 — the tick is idempotent and owns its own error accounting; a non-2xx would only retrigger it.
  // The failure is carried by the Sentry capture and the line's `errors: 1` / null counters, not the status.
  return NextResponse.json({ outcomes })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return extractOutcomesTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return extractOutcomesTick(request)
}
