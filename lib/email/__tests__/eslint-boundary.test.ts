import { ESLint } from 'eslint'
import { describe, it, expect } from 'vitest'

describe('ESLint resend boundary (ADR 0008 §4)', () => {
  it('bans direct resend import outside resend-provider.ts', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })
    const results = await eslint.lintText(
      `import { Resend } from 'resend'\nconst r = new Resend('x')\nvoid r\n`,
      { filePath: 'lib/email/forbidden-fixture.ts' },
    )
    const messages = results[0].messages
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)
  })

  it('allows direct resend import inside resend-provider.ts', async () => {
    const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })
    const results = await eslint.lintText(
      `import { Resend } from 'resend'\nconst r = new Resend('x')\nvoid r\n`,
      { filePath: 'lib/email/resend-provider.ts' },
    )
    const messages = results[0].messages
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false)
  })
})
