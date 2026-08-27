// ADR 0020 §4 — Stage A end to end: claim → mint → conditional fetch →
// parse → insert/edit/duplicate → Stage B score+upsert, per connection,
// once an hour. Mirrors lib/learning/orchestrator.ts's shape exactly: lazy
// service-role import, Sentry.withMonitor, one canonical tick log line, a
// per-business try/catch so one business's failure cannot abort the loop
// for the others (L-11, SIGNAL-FAILURE-ISOLATED).
//
// L-1 — ZERO imports of @/lib/ai/* or @anthropic-ai/sdk anywhere in this
// file. Stage A/B are Tier-0, deterministic, no LLM calls (enforced
// executably by E2.10's source scan).

import * as Sentry from '@sentry/nextjs'
import { addSeconds, formatISO, subDays } from 'date-fns'
import { createHash } from 'node:crypto'
import {
  listConnectionsReadyForPoll,
  claimGithubConnectionForPoll,
  completeGithubConnectionPoll,
  deactivateGithubConnection,
  recordGithubConnectionRateLimited,
} from '@/lib/db/github-connections'
import { listActiveWatchedReposForConnection, updateWatchedRepoPollCursor, deactivateWatchedRepo } from '@/lib/db/watched-repos'
import { listSignalsForWatchedRepo, insertSignal, updateSignalContent } from '@/lib/db/signals'
import type { GithubConnectionRow, SignalRow, SignalInsert, UntrustedText } from '@/lib/db/types'
import { mintInstallationToken, getReleases, GithubClientError } from './github-client'
import { parseRelease, type ParsedSignal } from './parse-release'
import { scoreSignal, upsertScoredCandidate } from './score'
import { pollWatchedFeeds, emptyRssTickSummary, type RssTickSummary } from './rss-orchestrator'

// ADR 0023 §3.4/§9.4 (Session 30 G1b.5) — RssTickSummary's fields are
// spread into this interface (not nested under a sub-key) so every counter
// — GitHub and RSS alike — lands in the SAME flat JSON tick line (§9.4
// clause 4), one canonical structured log line per invocation, per
// CLAUDE.md's worker carve-out.
export interface SignalsTickSummary extends RssTickSummary {
  tick: string
  triggeredBy: 'qstash' | 'secret'
  durationMs: number
  connectionsClaimed: number
  reposPolled: number
  notModified: number
  signalsIngested: number
  signalsUpdated: number
  duplicates: number
  candidatesUpserted: number
  revoked: number
  rateLimited: number
  notFound: number
  malformed: number
  failed: number
  // [Session 27-D · D5, MINOR-5] CONTENT-FILTER counters, distinct from the
  // §4.5 FAILURE counters above (revoked/rateLimited/notFound/malformed/
  // failed): a draft release or a pre-cutoff release is not a failure of
  // anything — it is the poller correctly declining to ingest content §5.1/
  // §4.4 say should never become a signal. Kept out of `failed` and out of
  // §4.5's failure table deliberately, so a drafts-only repo is never read
  // as an error. ADR §4.6 amended to include both in the canonical tick line.
  skippedDraft: number
  skippedPreCutoff: number
}

// §7.3's sink-narrowed hash replica of the DB's generated column
// (signals.content_hash, 20260731090000_signal_ingestion.sql:123-125:
// `encode(sha256(title::bytea || '\x00'::bytea || body::bytea), 'hex')`).
// Verified byte-for-byte against a live Postgres computation before this
// file was written, not merely assumed equivalent. Computing this app-side
// is what lets the diff-new-vs-edited-vs-duplicate decision (§4.4) happen
// WITHOUT a wasted write for a byte-identical retried delivery — only a
// genuinely new or genuinely changed signal reaches insertSignal/
// updateSignalContent at all.
function computeContentHash(title: string, body: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(title, 'utf8'), Buffer.from([0]), Buffer.from(body, 'utf8')]))
    .digest('hex')
}

async function scoreAndUpsertCandidate(
  businessId: string,
  signal: SignalRow,
  repoWeight: number,
  now: Date,
  summary: SignalsTickSummary,
): Promise<void> {
  const scored = scoreSignal(
    {
      externalId: signal.external_id,
      occurredAt: signal.occurred_at,
      bodyLen: signal.body.length,
      isBot: signal.author_is_bot,
      repoWeight,
      kind: 'release',
    },
    now,
  )
  const candidate = await upsertScoredCandidate(businessId, signal.id, scored)
  // A null return is the §6.4 guard's no-op (the candidate was already
  // dismissed) — not counted as an upsert, and not an error.
  if (candidate) summary.candidatesUpserted++
}

// §4.3/§4.4 — one parsed release, diffed against the pre-fetched existing
// map by external_id, then either inserted (new), updated in place
// (content_hash differs — a real edit), or counted as a duplicate (same
// external_id, same content — a retried delivery or an overlapping tick).
async function ingestParsedSignal(
  businessId: string,
  watchedRepoId: string,
  repoWeight: number,
  parsed: ParsedSignal,
  existingByExternalId: Map<string, SignalRow>,
  now: Date,
  summary: SignalsTickSummary,
): Promise<void> {
  const existing = existingByExternalId.get(parsed.external_id)

  if (!existing) {
    const insert: SignalInsert = {
      business_id: businessId,
      watched_repo_id: watchedRepoId,
      source: 'github',
      kind: 'release',
      ingested_via: 'poll',
      ...parsed,
    }
    const result = await insertSignal(insert)
    if (result.status === 'duplicate') {
      // §4.3 — a concurrent overlapping run's insert won the race between
      // this tick's read of existingByExternalId and this write; the
      // UNIQUE index is the actual arbiter, this map was only ever a
      // pre-filter to avoid the common case's round trip.
      summary.duplicates++
      return
    }
    summary.signalsIngested++
    await scoreAndUpsertCandidate(businessId, result.signal, repoWeight, now, summary)
    return
  }

  // parse-release.ts's parser always sets body (defaulting a null GitHub
  // body to ''), but SignalInsert.body is typed optional because the
  // INSERT path can rely on the column's own default — this UPDATE path
  // needs a concrete value, so the same '' fallback is applied here.
  const body = parsed.body ?? ('' as UntrustedText)
  const newHash = computeContentHash(parsed.title, body)
  if (newHash === existing.content_hash) {
    summary.duplicates++
    return
  }

  const updated = await updateSignalContent(existing.id, businessId, {
    title: parsed.title,
    body,
    body_truncated: parsed.body_truncated ?? false,
  })
  summary.signalsUpdated++
  await scoreAndUpsertCandidate(businessId, updated, repoWeight, now, summary)
}

// §4.5 — mint-time failure classes. No repo target exists yet at this
// point (minting is per-installation, not per-repo), so a 404 here means
// the installation itself is gone — operationally identical to a
// revocation (§2.5), not a separate, unlisted operator state.
async function handleMintFailure(
  err: unknown,
  connection: GithubConnectionRow,
  now: Date,
  summary: SignalsTickSummary,
): Promise<void> {
  if (err instanceof GithubClientError) {
    if (err.code === 'revoked' || err.code === 'not_found') {
      await deactivateGithubConnection(connection.business_id, 'revoked')
      summary.revoked++
      Sentry.captureException(err, { tags: { business_id: connection.business_id, phase: 'signals-mint' } })
      return
    }
    if (err.code === 'rate_limited') {
      // A guessed default (1 hour, matching cadence) ONLY when GitHub's own
      // Retry-After header was absent — retryAfterSeconds itself is never
      // guessed (GithubClientError's own contract); this is a fallback for
      // how long to mark the UI state, not a fabricated protocol value.
      const until = formatISO(addSeconds(now, err.retryAfterSeconds ?? 3600))
      await recordGithubConnectionRateLimited(connection.business_id, until)
      summary.rateLimited++
      return
    }
    // 'transient' (5xx or unclassified GitHub-side failure) — count and
    // retry next tick; no state change (§4.5).
    summary.failed++
    return
  }
  // Unclassified — propagate to the per-business handler in runSignalsTick,
  // which owns Sentry-reporting genuinely unexpected failures.
  throw err
}

async function pollConnection(connection: GithubConnectionRow, now: Date, summary: SignalsTickSummary): Promise<void> {
  let token
  try {
    token = await mintInstallationToken(connection.installation_id)
  } catch (err) {
    await handleMintFailure(err, connection, now, summary)
    return
  }

  const repos = await listActiveWatchedReposForConnection(connection.id, connection.business_id)
  // §2.5 — exclusion of a disconnected connection is structural (is_active
  // filtering happens in the claim query, never a branch here); this flag
  // is only for a revocation/rate-limit discovered MID-loop (the token was
  // valid at mint time but died between repos, e.g. racing a disconnect) —
  // the shared per-installation budget means the rest of this business's
  // repos cannot succeed either, so the loop stops for this business only.
  let connectionFailed = false

  for (const repo of repos) {
    if (connectionFailed) break
    summary.reposPolled++
    try {
      const result = await getReleases(token.token, repo.owner, repo.name, repo.releases_etag)
      if (result.status === 'not_modified') {
        // §4.4 / SIGNAL-POLL-CONDITIONAL — nothing changed, including
        // edits. No writes at all, not even the cursor (its value would be
        // identical anyway).
        summary.notModified++
        continue
      }

      const existingSignals = await listSignalsForWatchedRepo(repo.id, connection.business_id)
      const existingByExternalId = new Map(existingSignals.map((s) => [s.external_id, s]))
      // §4.4 — a first-ever poll (no prior last_polled_at) ingests only
      // releases published within the last 90 days, so a brand-new
      // connection does not backfill years of history into Session 28's
      // feed on day one.
      const isFirstPoll = repo.last_polled_at === null
      const cutoff = isFirstPoll ? subDays(now, 90) : null

      for (const release of result.releases) {
        const parsed = parseRelease(release)
        if (parsed.status === 'malformed') {
          summary.malformed++
          // §7 — repo id and Zod's own type-shape issue messages only
          // (e.g. "expected string, received undefined"), NEVER the
          // release's actual field values: untrusted text into logs is its
          // own vector.
          Sentry.captureException(new Error('signals: malformed release payload'), {
            tags: { repo_id: String(repo.repo_id), business_id: connection.business_id },
            extra: { issues: parsed.issues },
          })
          continue
        }
        if (parsed.status === 'skipped_draft') {
          summary.skippedDraft++
          continue
        }
        if (cutoff && new Date(parsed.signal.occurred_at) < cutoff) {
          summary.skippedPreCutoff++
          continue
        }

        await ingestParsedSignal(connection.business_id, repo.id, repo.weight, parsed.signal, existingByExternalId, now, summary)
      }

      await updateWatchedRepoPollCursor(repo.id, connection.business_id, result.etag)
    } catch (err) {
      if (err instanceof GithubClientError) {
        if (err.code === 'not_found') {
          await deactivateWatchedRepo(repo.id, connection.business_id)
          summary.notFound++
          continue
        }
        if (err.code === 'revoked') {
          await deactivateGithubConnection(connection.business_id, 'revoked')
          summary.revoked++
          Sentry.captureException(err, { tags: { business_id: connection.business_id, phase: 'signals-fetch' } })
          connectionFailed = true
          continue
        }
        if (err.code === 'rate_limited') {
          const until = formatISO(addSeconds(now, err.retryAfterSeconds ?? 3600))
          await recordGithubConnectionRateLimited(connection.business_id, until)
          summary.rateLimited++
          connectionFailed = true
          continue
        }
        // 'transient' — this repo only; the rest of this connection's
        // repos are unaffected.
        summary.failed++
        continue
      }
      // Unclassified — propagate to the per-business handler.
      throw err
    }
  }

  if (!connectionFailed) {
    await completeGithubConnectionPoll(connection.id, connection.business_id, 'ok')
  }
}

// §4.1 — hourly cadence. Rate-limit defence, stated as arithmetic so a
// future "just make it 15 minutes" change has to confront the number it
// breaks: 20 watched repos (the E2.1 cap) × 1 request/repo (page 1 only,
// per_page=30) = 20 calls, +1 for the installation-token mint = 21
// calls/hour, against a 5,000/hour PER-INSTALLATION budget. A 304 (nothing
// changed) costs the same 1 call either way — this arithmetic is about the
// WORST case, every repo changed, every hour.
export async function runSignalsTick(opts: { triggeredBy: 'qstash' | 'secret' }): Promise<SignalsTickSummary> {
  const startedAt = Date.now()
  const now = new Date()
  const summary: SignalsTickSummary = {
    tick: formatISO(now),
    triggeredBy: opts.triggeredBy,
    durationMs: 0,
    connectionsClaimed: 0,
    reposPolled: 0,
    notModified: 0,
    signalsIngested: 0,
    signalsUpdated: 0,
    duplicates: 0,
    candidatesUpserted: 0,
    revoked: 0,
    rateLimited: 0,
    notFound: 0,
    malformed: 0,
    failed: 0,
    skippedDraft: 0,
    skippedPreCutoff: 0,
    ...emptyRssTickSummary(),
  }

  try {
    await Sentry.withMonitor(
      'signals-poll',
      async () => {
        // §4.2 — bounded, ordered candidate list (matches
        // github_connections_poll_claim_idx), then an ATOMIC conditional
        // UPDATE per candidate (claimGithubConnectionForPoll), never a
        // read-then-update: the claim re-guards the exact same window the
        // list selected against, so a connection already claimed by a
        // concurrent tick returns null here rather than being claimed
        // twice. §4.2's revival condition: if an out-of-band "poll now" or
        // backfill trigger is ever added, this watermark claim is the
        // wrong mechanism and must become the learning_capture.sql:231-246
        // FOR UPDATE SKIP LOCKED pattern instead.
        const candidates = await listConnectionsReadyForPoll()

        for (const candidate of candidates) {
          const claimed = await claimGithubConnectionForPoll(candidate.id)
          if (!claimed) continue
          summary.connectionsClaimed++

          try {
            await pollConnection(claimed, now, summary)
          } catch (err) {
            // L-11 / SIGNAL-FAILURE-ISOLATED — mirrors
            // lib/learning/orchestrator.ts:354-377 exactly: this catch is
            // for a genuinely unexpected failure pollConnection's own §4.5
            // classification didn't already contain (a DB write failure, a
            // bug). One business's failure here cannot abort the loop for
            // the others.
            summary.failed++
            Sentry.captureException(err, { tags: { business_id: claimed.business_id, phase: 'signals-poll' } })
          }
        }

        // ADR 0023 §3.4/§9 (Session 30 G1b.5) — the market-responsive
        // source, sharing this SAME tick, monitor and cron route (§3.4:
        // "one poll per active feed per daily tick, aligned to the
        // existing signals-poll cron" — not a second cadence, not a second
        // route). Per-feed isolation is internal to pollWatchedFeeds; this
        // try/catch is one layer further out, guarding against a failure
        // before that function's own per-feed loop even starts (e.g. the
        // candidate-list query itself failing) — mirrors the GitHub loop's
        // own outer/inner isolation shape exactly.
        try {
          const rssSummary = await pollWatchedFeeds(now)
          Object.assign(summary, rssSummary)
        } catch (err) {
          summary.rssFeedsFailed++
          Sentry.captureException(err, { tags: { phase: 'signals-rss-poll' } })
        }
      },
      {
        schedule: { type: 'crontab', value: '0 * * * *' },
        checkinMargin: 10,
        maxRuntime: 55,
        failureIssueThreshold: 2,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'signals-poll' } })
  }

  summary.durationMs = Date.now() - startedAt

  // §4.6 — exactly ONE structured-JSON console.log per invocation, the
  // sole operator-observability line (CLAUDE.md's worker carve-out).
  console.log(JSON.stringify({ kind: 'signals.tick', ...summary }))

  return summary
}
