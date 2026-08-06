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
} from './github-client'

export { parseRelease, BODY_MAX_CHARS } from './parse-release'
export type { ParsedSignal, ParseReleaseResult } from './parse-release'
