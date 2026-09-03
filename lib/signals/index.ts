// ADR 0020 §10.1 — the ONLY public surface of the signal-source module, in
// the same sentence shape as CLAUDE.md's /lib/social/ and /lib/ai/ rules:
//
//   No code outside lib/signals/ ever imports a GitHub client package.
//   All consumers import from lib/signals/index.ts. Business logic talks
//   to the signal-source interface, never to Octokit.
//
// Enforced by a source scan (ADR §11.3 scan #2), not by convention.

export {
  mintInstallationToken,
  getReleases,
  getUserInstallations,
  getInstallationRepositories,
  exchangeUserCode,
  GithubClientError,
} from './github-client'

export type {
  GithubErrorCode,
  InstallationToken,
  GithubRelease,
  GithubReleaseAuthor,
  ReleasesResult,
  GithubInstallationSummary,
  GithubInstallationAccount,
  GithubRepoSummary,
  GithubRepoOwner,
  UserTokenExchangeResult,
} from './github-client'

export { parseRelease, BODY_MAX_CHARS } from './parse-release'
export type { ParsedSignal, ParseReleaseResult } from './parse-release'

// ADR 0023 §3.1/§7.1 — the market-responsive (RSS/Atom) source's fetch,
// egress-guard and mint boundary, parallel to the GitHub exports above.
export { fetchAndParseFeed } from './rss-client'
export type { FetchAndParseFeedResult, FetchAndParseFeedOptions, RssClientErrorCode } from './rss-client'

export { parseArticleItem, BODY_MAX_CHARS as ARTICLE_BODY_MAX_CHARS } from './parse-article'
export type { ParsedArticle, ParseArticleResult, RawFeedItem } from './parse-article'

export { fetchWithEgressGuard, rejectIfDeclaresDoctype, validateUrl, XxeRejectedError } from './rss-egress-guard'
export type { EgressFetchResult, EgressFetchOptions, EgressGuardErrorCode } from './rss-egress-guard'

export { scoreSignal, sortScoredSignals, scoreAndSortSignals, upsertScoredCandidate } from './score'
export type { ScoreInputs, ScorableSignal, ScoredSignal } from './score'

// ADR 0023 §8.2/§8.4 (Session 30 G1b.9) — the settings/signals/ Server
// Action's own watch-list hash, delegating to the same algorithm §3.4
// established for item-dedup rather than reimplementing it.
export { computeWatchedFeedUrlHash } from './rss-orchestrator'
