import { describe, it, expect } from 'vitest'
import { generatePkceVerifier, generatePkceChallenge } from './pkce-crypto'

describe('generatePkceVerifier / generatePkceChallenge', () => {
  it('the verifier is 43 chars of unreserved base64url characters (RFC 7636 §4.1 minimum length)', () => {
    const verifier = generatePkceVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  })

  it('two calls produce different verifiers', () => {
    expect(generatePkceVerifier()).not.toBe(generatePkceVerifier())
  })

  it('the S256 challenge is deterministic for a given verifier and differs from the verifier itself', async () => {
    const verifier = 'fixed-test-verifier-value-for-deterministic-check'
    const c1 = await generatePkceChallenge(verifier)
    const c2 = await generatePkceChallenge(verifier)
    expect(c1).toBe(c2)
    expect(c1).not.toBe(verifier)
  })
})
