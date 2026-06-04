import { Receiver } from '@upstash/qstash'
import type { NextRequest } from 'next/server'
import { config } from '@/lib/config'

export class QStashAuthError extends Error {
  constructor(public readonly reason: string) {
    super('Unauthorized')
    this.name = 'QStashAuthError'
  }
}

// Module-level singleton (ADR 0005 Amendment 1 §3 D6). Constructed lazily on
// first call so test mocks of @upstash/qstash and config can take effect.
let receiver: Receiver | null = null

function getReceiver(): Receiver {
  if (receiver) return receiver
  const current = config.server.QSTASH_CURRENT_SIGNING_KEY
  const next = config.server.QSTASH_NEXT_SIGNING_KEY
  if (!current || !next) {
    throw new QStashAuthError('qstash-config-missing')
  }
  receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next })
  return receiver
}

export async function verifyQStashRequest(request: NextRequest): Promise<void> {
  if (request.method !== 'POST') {
    throw new QStashAuthError('qstash-requires-post')
  }
  const signature = request.headers.get('upstash-signature')
  if (!signature) {
    throw new QStashAuthError('qstash-missing-signature')
  }
  // Raw body read once before any parse (ADR 0005 Amendment 1 §3 D4).
  const body = await request.text()
  // getReceiver() is outside the try so config errors propagate as
  // qstash-config-missing, not qstash-invalid-signature.
  const rcv = getReceiver()
  try {
    await rcv.verify({ signature, body, url: request.url })
  } catch {
    throw new QStashAuthError('qstash-invalid-signature')
  }
}
