import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } }
  }),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM: 'hello@mail.sosh.app',
      EMAIL_PROVIDER: 'resend',
    },
  },
}))

import { ResendEmailProvider } from '../resend-provider'
import { EmailProviderError } from '../errors'

const baseInput = {
  to: 'user@example.com',
  subject: 'Test Subject',
  html: '<p>Hello</p>',
  text: 'Hello',
  replyTo: 'support@sosh.app',
  idempotencyKey: 'idem-key-001',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ResendEmailProvider', () => {
  it('successful send returns providerMessageId from data.id', async () => {
    mockSend.mockResolvedValue({ data: { id: 'resend-msg-abc' }, error: null })
    const provider = new ResendEmailProvider()
    const result = await provider.send(baseInput)
    expect(result.providerMessageId).toBe('resend-msg-abc')
  })

  it('passes idempotencyKey as second arg to emails.send', async () => {
    mockSend.mockResolvedValue({ data: { id: 'resend-msg-abc' }, error: null })
    const provider = new ResendEmailProvider()
    await provider.send(baseInput)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com' }),
      expect.objectContaining({ idempotencyKey: 'idem-key-001' }),
    )
  })

  it('429 status code → EmailProviderError provider_rate_limit', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Too Many Requests', statusCode: 429, name: 'rate_limit_exceeded' },
    })
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'provider_rate_limit',
      name: 'EmailProviderError',
    })
  })

  it('503 status code → EmailProviderError provider_unavailable', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Service Unavailable', statusCode: 503, name: 'internal_server_error' },
    })
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'provider_unavailable',
      name: 'EmailProviderError',
    })
  })

  it('422 with invalid address name → EmailProviderError invalid_recipient', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email address', statusCode: 422, name: 'invalid_to' },
    })
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'invalid_recipient',
      name: 'EmailProviderError',
    })
  })

  it('network throw (fetch failure) → EmailProviderError provider_unavailable', async () => {
    mockSend.mockRejectedValue(new TypeError('fetch failed'))
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'provider_unavailable',
      name: 'EmailProviderError',
    })
  })

  it('re-throws EmailProviderError without wrapping', async () => {
    const original = new EmailProviderError('unknown', 'direct throw')
    mockSend.mockRejectedValue(original)
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toBe(original)
  })

  it('unknown non-429/5xx error → EmailProviderError unknown', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Something went wrong', statusCode: 400, name: 'validation_error' },
    })
    const provider = new ResendEmailProvider()
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'unknown',
      name: 'EmailProviderError',
    })
  })
})
