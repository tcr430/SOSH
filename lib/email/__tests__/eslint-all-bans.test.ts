import { ESLint } from 'eslint'
import { describe, it, expect } from 'vitest'

/**
 * B-01 regression: all four package bans fire from a single neutral path.
 *
 * The four existing boundary tests each use a filePath inside the package they
 * test (e.g. lib/email/forbidden-fixture.ts for resend).  After the ESLint
 * consolidation those paths sit inside the per-package override blocks, which
 * relax one ban each — the tests therefore do not exercise the main consolidated
 * block in isolation.  This test uses app/__test_fixtures__/boundary-probe.ts,
 * which matches only the main block, so all four bans must fire together.
 */
describe('ESLint no-restricted-imports — all four bans active on shared path (B-01)', () => {
  it('fires all four package bans at app/__test_fixtures__/boundary-probe.ts', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

    // One import per restricted package; each should produce exactly one violation.
    const code = [
      "import Stripe from 'stripe'",
      "import { Anthropic } from '@anthropic-ai/sdk'",
      "import { Resend } from 'resend'",
      "import { getRegistry } from '@/lib/social/registry'",
      'void Stripe; void Anthropic; void Resend; void getRegistry',
    ].join('\n')

    const [result] = await eslint.lintText(code, {
      filePath: 'app/__test_fixtures__/boundary-probe.ts',
    })

    const violations = result.messages.filter(
      (m) => m.ruleId === 'no-restricted-imports',
    )
    expect(violations).toHaveLength(4)
  })
})
