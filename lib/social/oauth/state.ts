import { SignJWT, jwtVerify } from 'jose'
import { config } from '@/lib/config'
import type { Platform } from '@/lib/db/types'

export interface OAuthStateClaims {
  businessId: string
  platform: Platform
  nonce: string
}

function getSecret(): Uint8Array {
  const raw = config.server.OAUTH_STATE_SECRET
  if (!raw || raw.length < 32) {
    throw new Error(
      'OAUTH_STATE_SECRET must be set to at least 32 characters before using OAuth flows',
    )
  }
  return new TextEncoder().encode(raw)
}

export async function signOAuthState(input: {
  businessId: string
  platform: Platform
}): Promise<string> {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')

  return new SignJWT({ businessId: input.businessId, platform: input.platform, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSecret())
}

export async function verifyOAuthState(token: string): Promise<OAuthStateClaims> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

  if (
    typeof payload['businessId'] !== 'string' ||
    typeof payload['platform'] !== 'string' ||
    typeof payload['nonce'] !== 'string'
  ) {
    throw new Error('Invalid OAuth state claims')
  }

  return {
    businessId: payload['businessId'],
    platform: payload['platform'] as Platform,
    nonce: payload['nonce'],
  }
}
