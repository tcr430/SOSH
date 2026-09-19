import { NextRequest, NextResponse } from 'next/server'
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
  let outcomes: OutcomeTickSummary
  try {
    outcomes = await runOutcomeTick({ triggeredBy })
  } catch {
    outcomes = {
      triggeredBy, tick: formatISO(new Date()), durationMs: Date.now() - startedAt,
      candidates: 0, matured: 0, outcomesWritten: 0, skippedNoMetrics: 0, skippedNoBaseline: 0,
      skippedIneligibleField: 0, cellsRecomputed: 0, candidatesUpserted: 0, promoted: 0, demoted: 0,
      retrospectivesCompleted: 0, errors: 1,
    }
  }

  // The ONE canonical structured-JSON line (CLAUDE.md worker carve-out). EXACTLY ADR 0026 §14's keys, picked
  // by name so nothing else can leak in: no content, no business id, no hypothesis text.
  console.log(JSON.stringify({
    kind: 'outcome.tick',
    triggeredBy: outcomes.triggeredBy,
    tick: outcomes.tick,
    durationMs: outcomes.durationMs,
    candidates: outcomes.candidates,
    matured: outcomes.matured,
    outcomesWritten: outcomes.outcomesWritten,
    skippedNoMetrics: outcomes.skippedNoMetrics,
    skippedNoBaseline: outcomes.skippedNoBaseline,
    skippedIneligibleField: outcomes.skippedIneligibleField,
    cellsRecomputed: outcomes.cellsRecomputed,
    candidatesUpserted: outcomes.candidatesUpserted,
    promoted: outcomes.promoted,
    demoted: outcomes.demoted,
    retrospectivesCompleted: outcomes.retrospectivesCompleted,
    errors: outcomes.errors,
  }))

  // Always 200 — the tick is idempotent and owns its own error accounting; a non-2xx would only retrigger it.
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
