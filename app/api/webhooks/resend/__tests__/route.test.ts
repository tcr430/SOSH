import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Webhook } from 'svix'

// ─── Test secret (must match the config mock below) ───────────────────────────

const TEST_SECRET = 'whsec_' + Buffer.from('test-signing-secret-for-vitest-1').toString('base64')

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: { server: { RESEND_WEBHOOK_SECRET: TEST_SECRET } },
}))

const mockRecordWebhookEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/email-webhook-events', () => ({
  recordWebhookEvent: mockRecordWebhookEvent,
}))

const mockUpsertSuppression = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/email-suppressions', () => ({
  upsertSuppression: mockUpsertSuppression,
}))

// ─── Route factory (imported after mocks) ────────────────────────────────────

async function getRoute() {
  const mod = await import('../route')
  return mod.POST
}

// ─── Svix signing helpers ─────────────────────────────────────────────────────

function makeSignedRequest(
  body: object,
  opts: { eventId?: string; secret?: string } = {},
): Request {
  const eventId = opts.eventId ?? 'msg_test_01'
  const secret = opts.secret ?? TEST_SECRET
  const wh = new Webhook(secret)
  const bodyStr = JSON.stringify(body)
  const ts = new Date()
  const signature = wh.sign(eventId, ts, bodyStr)
  const tsStr = Math.floor(ts.getTime() / 1000).toString()

  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': eventId,
      'svix-timestamp': tsStr,
      'svix-signature': signature,
    },
    body: bodyStr,
  })
}

function makeUnsignedRequest(body: object): Request {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

const bouncedPayload = {
  type: 'email.bounced',
  data: { email_id: 'email-1', to: ['bounce@example.com'] },
}

const complainedPayload = {
  type: 'email.complained',
  data: { email_id: 'email-2', to: ['complaint@example.com'] },
}

const deliveredPayload = {
  type: 'email.delivered',
  data: { email_id: 'email-3', to: ['ok@example.com'] },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordWebhookEvent.mockResolvedValue({ inserted: true, normalised_event_type: 'email.bounced' })
  mockUpsertSuppression.mockResolvedValue({ inserted: true })
})

describe('POST /api/webhooks/resend', () => {
  it('valid signature + email.bounced → 200 and upsertSuppression with reason=bounce', async () => {
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(bouncedPayload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'bounce@example.com',
        reason: 'bounce',
        source_event_id: 'msg_test_01',
      }),
    )
  })

  it('valid signature + email.complained → 200 and upsertSuppression with reason=complaint', async () => {
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(complainedPayload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'complaint@example.com',
        reason: 'complaint',
        source_event_id: 'msg_test_01',
      }),
    )
  })

  it('valid signature + email.delivered → 200 and no suppression', async () => {
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(deliveredPayload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
  })

  it('duplicate event id (recordWebhookEvent returns inserted=false) → 200 and no suppression', async () => {
    mockRecordWebhookEvent.mockResolvedValue({ inserted: false })
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(bouncedPayload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
  })

  it('recordWebhookEvent is called with svix-id as id and event type', async () => {
    const POST = await getRoute()
    await POST(makeSignedRequest(bouncedPayload, { eventId: 'msg_unique_99' }))

    expect(mockRecordWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'msg_unique_99',
        event_type: 'email.bounced',
      }),
    )
  })

  it('invalid signature → 400 and no DB writes', async () => {
    const wrongSecret = 'whsec_' + Buffer.from('wrong-secret-for-test-xxxxxxxxxx').toString('base64')
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(bouncedPayload, { secret: wrongSecret }))

    expect(res.status).toBe(400)
    expect(mockRecordWebhookEvent).not.toHaveBeenCalled()
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
  })

  it('missing svix headers → 400 and no DB writes', async () => {
    const POST = await getRoute()
    const res = await POST(makeUnsignedRequest(bouncedPayload))

    expect(res.status).toBe(400)
    expect(mockRecordWebhookEvent).not.toHaveBeenCalled()
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
  })

  it('email address is lowercased before suppression upsert', async () => {
    const payload = { type: 'email.bounced', data: { email_id: 'e1', to: ['User@EXAMPLE.COM'] } }
    const POST = await getRoute()
    await POST(makeSignedRequest(payload))

    expect(mockUpsertSuppression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'user@example.com' }),
    )
  })

  it.each([
    ['email.sent'],
    ['email.delivery_delayed'],
    ['email.failed'],
    ['completely.unknown'],
  ])('unknown event type %s → 200, no suppression, log emits type:other', async (eventType) => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockRecordWebhookEvent.mockResolvedValue({ inserted: true, normalised_event_type: 'other' })
    const payload = { type: eventType, data: { email_id: 'e-unk', to: ['x@y.com'] } }
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(payload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledOnce()
    const logged = JSON.parse(logSpy.mock.calls[0][0])
    expect(logged.type).toBe('other')
    logSpy.mockRestore()
  })

  it('email.bounced duplicate event → inserted:false, 200, no second suppression', async () => {
    mockRecordWebhookEvent.mockResolvedValue({ inserted: false, normalised_event_type: 'email.bounced' })
    const POST = await getRoute()
    const res = await POST(makeSignedRequest(bouncedPayload))

    expect(res.status).toBe(200)
    expect(mockUpsertSuppression).not.toHaveBeenCalled()
  })
})
