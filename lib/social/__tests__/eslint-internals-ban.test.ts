import { ESLint } from 'eslint'
import { describe, it, expect } from 'vitest'

// SOCIAL-INTERNALS-BAN-REPLACED (ADR 0028 §8.3, N2.11). "Moot once the file
// is gone" (launch-checklist.md §16 row 4, since corrected) is NOT the same
// as "replaced" — removing the postiz-provider entry without adding the two
// native provider entries would silently reopen the boundary CLAUDE.md
// calls non-negotiable. Asserted in a TEST, not lint config alone —
// lib/email/__tests__/eslint-all-bans.test.ts is the shipped precedent this
// mirrors.
describe('ESLint no-restricted-imports — SOCIAL_INTERNALS_BAN replaced, not removed', () => {
  it('bans @/lib/social/linkedin-provider and @/lib/social/twitter-provider from a file outside lib/social/', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

    const code = [
      "import { LinkedInProvider } from '@/lib/social/linkedin-provider'",
      "import { TwitterProvider } from '@/lib/social/twitter-provider'",
      'void LinkedInProvider; void TwitterProvider',
    ].join('\n')

    const [result] = await eslint.lintText(code, {
      filePath: 'app/__test_fixtures__/social-boundary-probe.ts',
    })

    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
    expect(violations).toHaveLength(2)
  })

  it('does NOT ban @/lib/social/postiz-provider any more — the entry was replaced, and the file it named is deleted', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

    const code = [
      "import { PostizProvider } from '@/lib/social/postiz-provider'",
      'void PostizProvider',
    ].join('\n')

    const [result] = await eslint.lintText(code, {
      filePath: 'app/__test_fixtures__/social-boundary-probe.ts',
    })

    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
    expect(violations).toHaveLength(0)
  })

  // SOCIAL-PROVIDER-BOUNDARY (ADR 0028 build-guide N2.13). The two tests
  // above only exercise 2 of SOCIAL_INTERNALS_BAN's 8 entries
  // (eslint.config.mjs) — proving the linkedin/twitter provider files are
  // banned says nothing about mock-provider, vault, registry, errors,
  // constants or oauth/*. Mirrors lib/email/__tests__/eslint-all-bans.test.ts's
  // "all bans fire together from one neutral path" shape, extended to the
  // full rewritten list so a silently-dropped entry (not just a silently
  // undeleted one) reddens too.
  it('all eight SOCIAL_INTERNALS_BAN entries fire together from a single neutral path', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

    const code = [
      "import { LinkedInProvider } from '@/lib/social/linkedin-provider'",
      "import { TwitterProvider } from '@/lib/social/twitter-provider'",
      "import { MockProvider } from '@/lib/social/mock-provider'",
      "import { readSecret } from '@/lib/social/vault'",
      "import { getRegistry } from '@/lib/social/registry'",
      "import { SocialProviderError } from '@/lib/social/errors'",
      "import { TOKEN_REFRESH_SKEW_SECONDS } from '@/lib/social/constants'",
      "import { signOAuthState } from '@/lib/social/oauth/state'",
      'void LinkedInProvider; void TwitterProvider; void MockProvider; void readSecret',
      'void getRegistry; void SocialProviderError; void TOKEN_REFRESH_SKEW_SECONDS; void signOAuthState',
    ].join('\n')

    const [result] = await eslint.lintText(code, {
      filePath: 'app/__test_fixtures__/social-boundary-probe.ts',
    })

    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
    expect(violations).toHaveLength(8)
  })
})
