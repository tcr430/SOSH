import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Stable mock references (created before any import via vi.hoisted) ────────
// The Receiver factory re-runs after vi.resetModules(); both references stay
// stable so tests can control verify() outcome and config values per-run.
const mockVerify = vi.hoisted(() => vi.fn())
const mockKeys = vi.hoisted(() => ({
  current: 'current-signing-key' as string | undefined,
  next: 'next-signing-key' as string | undefined,
}))

vi.mock('@upstash/qstash', () => ({
  Receiver: vi.fn().mockImplementation(function () { return { verify: mockVerify } }),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      get QSTASH_CURRENT_SIGNING_KEY() { return mockKeys.current },
      get QSTASH_NEXT_SIGNING_KEY() { return mockKeys.next },
    },
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  options: { signature?: string; url?: string } = {},
): NextRequest {
  const url = options.url ?? 'https://app.example.com/api/cron/publish'
  const headers = new Headers()
  if (options.signature !== undefined) {
    headers.set('upstash-signature', options.signature)
  }
  return new NextRequest(url, { method, headers })
}

// ── Module under test (re-imported fresh each test) ──────────────────────────
// vi.resetModules() clears the module cache so the module-level `receiver`
// singleton is null on each test — exercising the lazy-init path (amendment D6).

import type * as QStashAuthMod from '@/lib/cron/qstash-auth'
let mod: typeof QStashAuthMod

beforeEach(async () => {
  vi.resetModules()
  mockKeys.current = 'current-signing-key'
  mockKeys.next = 'next-signing-key'
  mockVerify.mockReset()
  mockVerify.mockResolvedValue(undefined)
  mod = await import('@/lib/cron/qstash-auth') as typeof QStashAuthMod
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('verifyQStashRequest', () => {
  it('valid POST + valid signature → resolves without throwing', async () => {
    const req = makeRequest('POST', { signature: 'valid-sig' })
    await expect(mod.verifyQStashRequest(req)).resolves.toBeUndefined()
  })

  it('GET request → QStashAuthError with reason qstash-requires-post', async () => {
    const req = makeRequest('GET', { signature: 'some-sig' })
    const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(mod.QStashAuthError)
    expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-requires-post')
  })

  it.each(['PUT', 'DELETE', 'PATCH'])(
    '%s request → QStashAuthError with reason qstash-requires-post',
    async (method) => {
      const req = makeRequest(method, { signature: 'some-sig' })
      const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(mod.QStashAuthError)
      expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-requires-post')
    },
  )

  it('POST with no Upstash-Signature header → QStashAuthError qstash-missing-signature', async () => {
    const req = makeRequest('POST')
    const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(mod.QStashAuthError)
    expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-missing-signature')
  })

  it('POST with invalid signature (Receiver.verify throws) → QStashAuthError qstash-invalid-signature', async () => {
    mockVerify.mockRejectedValue(new Error('signature mismatch'))
    const req = makeRequest('POST', { signature: 'bad-sig' })
    const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(mod.QStashAuthError)
    expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-invalid-signature')
  })

  it('config missing CURRENT key → QStashAuthError qstash-config-missing', async () => {
    mockKeys.current = undefined
    const req = makeRequest('POST', { signature: 'some-sig' })
    const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(mod.QStashAuthError)
    expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-config-missing')
  })

  it('config missing NEXT key → QStashAuthError qstash-config-missing', async () => {
    mockKeys.next = undefined
    const req = makeRequest('POST', { signature: 'some-sig' })
    const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(mod.QStashAuthError)
    expect((err as InstanceType<typeof mod.QStashAuthError>).reason).toBe('qstash-config-missing')
  })

  it('Error.message is the literal "Unauthorized" in every thrown case', async () => {
    const cases: Array<[NextRequest, string]> = [
      [makeRequest('GET', { signature: 'sig' }), 'requires-post'],
      [makeRequest('POST'), 'missing-signature'],
    ]
    for (const [req] of cases) {
      const err = await mod.verifyQStashRequest(req).catch((e: unknown) => e)
      expect((err as Error).message).toStrictEqual('Unauthorized')
    }
    // config-missing
    mockKeys.current = undefined
    const configErr = await mod
      .verifyQStashRequest(makeRequest('POST', { signature: 'sig' }))
      .catch((e: unknown) => e)
    expect((configErr as Error).message).toStrictEqual('Unauthorized')
    // invalid-signature
    mockKeys.current = 'current-signing-key'
    mockVerify.mockRejectedValue(new Error('bad'))
    const sigErr = await mod
      .verifyQStashRequest(makeRequest('POST', { signature: 'bad' }))
      .catch((e: unknown) => e)
    expect((sigErr as Error).message).toStrictEqual('Unauthorized')
  })
})
