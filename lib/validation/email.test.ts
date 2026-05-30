import { describe, it, expect } from 'vitest'
import { isWorkEmail, getEmailDomain, workEmailSchema, FREE_EMAIL_PROVIDERS } from './email'

// ---------------------------------------------------------------------------
// getEmailDomain
// ---------------------------------------------------------------------------
describe('getEmailDomain', () => {
  it('extracts domain and lowercases it', () => {
    expect(getEmailDomain('alice@ACME.COM')).toBe('acme.com')
  })

  it('handles plus addressing', () => {
    expect(getEmailDomain('user+tag@company.io')).toBe('company.io')
  })

  it('returns empty string when no @ present', () => {
    expect(getEmailDomain('notanemail')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(getEmailDomain('')).toBe('')
  })

  it('uses the last @ when multiple are present', () => {
    // "@" before domain is unusual but lastIndexOf should handle it
    expect(getEmailDomain('a@b@company.com')).toBe('company.com')
  })

  it('handles trailing whitespace gracefully', () => {
    expect(getEmailDomain('user@company.com  ')).toBe('company.com')
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — valid work emails
// ---------------------------------------------------------------------------
describe('isWorkEmail — valid work emails', () => {
  const validEmails = [
    'alice@acme.com',
    'bob@startup.io',
    'carol@company.co.uk',
    'dave@bigcorp.de',
    'eve@organisation.fr',
    'frank@mybusiness.com.br',
    'grace@tech.company',
    'admin@university.edu',
    'info@nonprofit.org',
    'contact@agency.net',
  ]

  validEmails.forEach((email) => {
    it(`accepts ${email}`, () => {
      expect(isWorkEmail(email)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — all blocked domains
// ---------------------------------------------------------------------------
describe('isWorkEmail — every blocked domain rejected', () => {
  ;[...FREE_EMAIL_PROVIDERS].forEach((domain) => {
    it(`rejects user@${domain}`, () => {
      expect(isWorkEmail(`user@${domain}`)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — subdomain blocking
// ---------------------------------------------------------------------------
describe('isWorkEmail — subdomain blocking', () => {
  it('blocks user@mail.gmail.com (subdomain of gmail.com)', () => {
    expect(isWorkEmail('user@mail.gmail.com')).toBe(false)
  })

  it('blocks user@smtp.hotmail.com (subdomain of hotmail.com)', () => {
    expect(isWorkEmail('user@smtp.hotmail.com')).toBe(false)
  })

  it('blocks user@m.yahoo.com (subdomain of yahoo.com)', () => {
    expect(isWorkEmail('user@m.yahoo.com')).toBe(false)
  })

  it('blocks user@webmail.protonmail.com (deep subdomain)', () => {
    expect(isWorkEmail('user@webmail.protonmail.com')).toBe(false)
  })

  it('does not block a domain that merely ends with a blocked name (no dot boundary)', () => {
    // e.g. "notgmail.com" should NOT be blocked — "gmail.com" is only blocked
    // when the full domain or a "."-prefixed suffix matches.
    expect(isWorkEmail('user@notgmail.com')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — case variations
// ---------------------------------------------------------------------------
describe('isWorkEmail — case variations', () => {
  it('blocks USER@GMAIL.COM', () => {
    expect(isWorkEmail('USER@GMAIL.COM')).toBe(false)
  })

  it('blocks User@Hotmail.Com', () => {
    expect(isWorkEmail('User@Hotmail.Com')).toBe(false)
  })

  it('blocks user@YAHOO.COM', () => {
    expect(isWorkEmail('user@YAHOO.COM')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — plus addressing
// ---------------------------------------------------------------------------
describe('isWorkEmail — plus addressing', () => {
  it('blocks user+tag@gmail.com (plus in local part)', () => {
    expect(isWorkEmail('user+tag@gmail.com')).toBe(false)
  })

  it('blocks newsletter+abc@hotmail.com', () => {
    expect(isWorkEmail('newsletter+abc@hotmail.com')).toBe(false)
  })

  it('accepts user+tag@acme.com (work domain with plus)', () => {
    expect(isWorkEmail('user+tag@acme.com')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — malformed and edge cases
// ---------------------------------------------------------------------------
describe('isWorkEmail — malformed and edge cases', () => {
  it('rejects empty string', () => {
    expect(isWorkEmail('')).toBe(false)
  })

  it('rejects string with no @', () => {
    expect(isWorkEmail('notanemail')).toBe(false)
  })

  it('rejects string with only @', () => {
    expect(isWorkEmail('@')).toBe(false)
  })

  it('rejects email with empty local part (@domain.com)', () => {
    expect(isWorkEmail('@acme.com')).toBe(false)
  })

  it('rejects email with empty domain (user@)', () => {
    expect(isWorkEmail('user@')).toBe(false)
  })

  it('rejects email with trailing spaces yielding empty domain', () => {
    expect(isWorkEmail('user@   ')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isWorkEmail — IDN punycode
// ---------------------------------------------------------------------------
describe('isWorkEmail — IDN punycode', () => {
  it('accepts a legitimate punycode domain (e.g. xn--nxasmq6b.com)', () => {
    // A punycode-encoded legitimate company domain should pass
    expect(isWorkEmail('user@xn--nxasmq6b.com')).toBe(true)
  })

  it('blocks a punycode subdomain of a blocked domain (xn--foo.gmail.com)', () => {
    // Subdomain rule still applies regardless of encoding
    expect(isWorkEmail('user@xn--foo.gmail.com')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// workEmailSchema (Zod)
// ---------------------------------------------------------------------------
describe('workEmailSchema', () => {
  it('passes for a valid work email', () => {
    const result = workEmailSchema.safeParse('alice@acme.com')
    expect(result.success).toBe(true)
  })

  it('fails with errors.email.work_required for a free-provider email', () => {
    const result = workEmailSchema.safeParse('user@gmail.com')
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('errors.email.work_required')
    }
  })

  it('fails with errors.email.invalid_format for a malformed address', () => {
    const result = workEmailSchema.safeParse('notanemail')
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('errors.email.invalid_format')
    }
  })

  it('fails for an empty string', () => {
    const result = workEmailSchema.safeParse('')
    expect(result.success).toBe(false)
  })
})
