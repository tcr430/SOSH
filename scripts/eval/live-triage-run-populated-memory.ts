// ADR 0023 §19 / Session 30-D D9 (A-7 ruling) — the ONE out-of-band live
// re-run this ruling calls for: the same 40 market-responsive examples,
// through the same production prompt logic and the same bounded tool-use
// loop shape as scripts/eval/live-triage-run.ts, but with POPULATED stub
// memory (plausible, generic, non-empty audience/brand/evidence/campaign
// content in the real tool-response SHAPES lib/signals/triage/tools.ts
// returns) instead of that script's universal empty stubs.
//
// WHY THIS EXISTS, SEPARATELY: G1b.13's live run (live-triage-run.ts)
// measured 0/24 recall under stubMemory: {} and current-phase.md/ADR 0023
// §19 attributed that to the total absence of memory context — but D8
// (Session 30-D) downgraded that attribution to a HYPOTHESIS, never tested.
// This script is the test: if populated memory measurably moves verdicts
// toward the expected ones, the hypothesis gains support; if it does not,
// the zero-memory condition is not the (or not the only) driver.
//
// WHAT THIS RUN IS NOT (A-1/A-7 both bind this): not a recurring lane (one
// manual invocation, per A-1's forbidding of a recurring live CI lane); not
// a new cassette commit — corpus.v2.json is read-only in this script and is
// NEVER written to. This run's output is EVIDENCE for the appendix, never a
// replacement for the corpus's existing G1b.13 cassettes.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAnthropicClient } from '../../lib/ai/client'
import type { TriageTool } from '../../lib/ai/tool-runner'
import { buildTriageSystemPrompt, buildTriageUserMessage } from '../../lib/signals/triage/orchestrator'
import { toFakeCandidate, runBoundedTriageLoop, type BoundedLoopResult } from './live-triage-run'

const CORPUS_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/corpus.v2.json')
const ARTEFACT_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/populated-memory-run.json')

interface CorpusExample {
  id: string
  source: 'github' | 'market_responsive'
  signal: {
    title: string
    html_url: string | null
    occurred_at: string
    is_prerelease: boolean
    author_is_bot: boolean
    body: string
  }
  stubMemory: unknown
  cassette?: unknown[]
  expectedVerdict: 'card' | 'no_card'
  expectedDismissReason?: string
}

interface CorpusFile {
  corpusVersion: number
  examples: CorpusExample[]
}

// Plausible, GENERIC content in the exact shapes lib/signals/triage/tools.ts
// returns (list_evidence: {ids, evidence}; the other three: array of rows) —
// a stand-in for "a business with real memory," not tuned per-example (that
// would make this a hand-crafted result, not a test of the hypothesis).
const POPULATED_EVIDENCE = {
  ids: ['ev-pop-1', 'ev-pop-2'],
  evidence:
    'Customer quote (Acme Corp, enterprise plan): "We chose this product specifically for its integration ecosystem and compliance posture." ' +
    'Usage data: our top-tier accounts cite platform reliability and third-party integrations as the leading reasons for renewal, per the most recent quarterly account-health review.',
}
const POPULATED_AUDIENCE = [
  { id: 'aud-pop-1', statement: 'Enterprise IT and security buyers evaluating vendor risk, compliance posture, and integration breadth before renewal or expansion.' },
  { id: 'aud-pop-2', statement: 'Growth-stage marketing and ops teams tracking competitor feature parity and industry regulatory shifts that could affect their own roadmap.' },
]
const POPULATED_BRAND_CLAIMS = [
  { id: 'brand-pop-1', statement: 'We have previously positioned ourselves as the most compliance-forward option in this category, with a stated commitment to transparent data handling.' },
  { id: 'brand-pop-2', statement: 'Our public messaging emphasizes reliability and platform stability as a key differentiator against faster-moving but less stable competitors.' },
]
const POPULATED_CAMPAIGNS = [
  { id: 'camp-pop-1', name: 'Q3 Compliance & Trust Campaign', objective: 'Reinforce our compliance-forward positioning ahead of enterprise renewal season.', specialInstructions: null },
  { id: 'camp-pop-2', name: 'Competitive Displacement Push', objective: 'Highlight reliability and integration breadth against a named competitor category.', specialInstructions: null },
]

function buildPopulatedStubTools(): TriageTool[] {
  return [
    {
      name: 'list_evidence',
      description:
        'List evidence memory (customer quotes, case studies, usage data) relevant to judging whether this release is worth surfacing.',
      inputSchema: { type: 'object' as const, properties: { objective: { type: 'string' }, platform: { type: 'string' }, audience: { type: 'string' } } },
      execute: async () => POPULATED_EVIDENCE,
    },
    {
      name: 'list_audience_notes',
      description: 'List audience memory (who cares about this release, and why) for this business.',
      inputSchema: { type: 'object' as const, properties: { objective: { type: 'string' }, platform: { type: 'string' }, audience: { type: 'string' } } },
      execute: async () => POPULATED_AUDIENCE,
    },
    {
      name: 'list_brand_claims',
      description: "List this business's own prior brand claims, to check whether a release conflicts with something already said.",
      inputSchema: { type: 'object' as const, properties: { objective: { type: 'string' }, platform: { type: 'string' }, audience: { type: 'string' } } },
      execute: async () => POPULATED_BRAND_CLAIMS,
    },
    {
      name: 'list_recent_campaigns',
      description: "List this business's most recent campaigns, to check for redundancy against what was already said.",
      inputSchema: { type: 'object' as const, properties: {} },
      execute: async () => POPULATED_CAMPAIGNS,
    },
  ]
}

async function main(): Promise<void> {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as CorpusFile
  const marketResponsive = corpus.examples.filter((e) => e.source === 'market_responsive')
  console.log(`live-triage-run-populated-memory: running ${marketResponsive.length} market_responsive example(s) with POPULATED stub memory (corpus.v2.json is READ-ONLY — not written to).`)

  const client = await getAnthropicClient()
  const tools = buildPopulatedStubTools()

  let totalCostCents = 0
  const results: Array<{ id: string; expectedVerdict: string; expectedDismissReason?: string; actualVerdict?: string; outcome: string; result: BoundedLoopResult }> = []

  for (const example of marketResponsive) {
    const candidate = toFakeCandidate(example)
    const systemPrompt = buildTriageSystemPrompt(candidate)
    const userMessage = buildTriageUserMessage(candidate)
    const result = await runBoundedTriageLoop(client, systemPrompt, userMessage, tools)
    totalCostCents += result.costCents
    results.push({
      id: example.id,
      expectedVerdict: example.expectedVerdict,
      expectedDismissReason: example.expectedDismissReason,
      actualVerdict: result.outcome === 'decision' ? result.decision!.verdict : undefined,
      outcome: result.outcome,
      result,
    })
    if (result.outcome === 'decision') {
      console.log(`  ${example.id}: ${result.decision!.verdict} (expected ${example.expectedVerdict})`)
    } else {
      console.error(`  ${example.id}: FAILED (${result.failureReason})`)
    }
  }

  const decisions = results.filter((r) => r.outcome === 'decision')
  const expectedCard = results.filter((r) => r.expectedVerdict === 'card')
  const recallHits = expectedCard.filter((r) => r.actualVerdict === 'card').length
  const predictedCard = decisions.filter((r) => r.actualVerdict === 'card')
  const truePositives = predictedCard.filter((r) => r.expectedVerdict === 'card').length

  const priorCleanCardCount = corpus.examples
    .filter((e) => e.source === 'market_responsive' && e.cassette !== undefined)
    .filter((e) => (e.cassette as [{ verdict: string }])[0].verdict === 'card').length

  const artefact = {
    generatedAt: new Date().toISOString(),
    note:
      'ADR 0023 §19 / Session 30-D D9 (A-7 ruling) — the ONE out-of-band live re-run testing whether the ' +
      'stubMemory: {} (zero-memory) attribution for G1b.13\'s 0/24 recall result is a genuine cause. ' +
      'corpus.v2.json was NOT modified by this run — this artefact is evidence, not a new cassette commit.',
    exampleCount: results.length,
    errorCount: results.length - decisions.length,
    recall: { hits: recallHits, denominator: expectedCard.length },
    precision: { hits: truePositives, denominator: predictedCard.length },
    priorCleanRunCardCount: priorCleanCardCount,
    populatedRunCardCount: predictedCard.length,
    costCents: totalCostCents,
    results: results.map((r) => ({ id: r.id, expectedVerdict: r.expectedVerdict, expectedDismissReason: r.expectedDismissReason, actualVerdict: r.actualVerdict, outcome: r.outcome })),
  }

  writeFileSync(ARTEFACT_PATH, JSON.stringify(artefact, null, 2) + '\n')
  console.log(`live-triage-run-populated-memory: done. recall ${recallHits}/${expectedCard.length} (was 0/24 clean), precision ${truePositives}/${predictedCard.length} (was 0/0 clean). Cost: ${(totalCostCents / 100).toFixed(2)} USD.`)
  console.log(`live-triage-run-populated-memory: corpus.v2.json untouched — artefact written to ${ARTEFACT_PATH}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error('live-triage-run-populated-memory: fatal error', err)
    process.exit(1)
  })
}
