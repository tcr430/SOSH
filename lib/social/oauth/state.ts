import { SignJWT, jwtVerify } from 'jose'
import { config } from '@/lib/config'
import type { Platform, Language } from '@/lib/db/types'

const VALID_LOCALES: readonly Language[] = ['en', 'pt', 'es']

export interface OAuthStateClaims {
  businessId: string
  platform: Platform
  nonce: string
  locale: Language
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
  locale: Language
}): Promise<string> {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')

  return new SignJWT({ businessId: input.businessId, platform: input.platform, nonce, locale: input.locale })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSecret())
}

export async function verifyOAuthState(token: string): Promise<OAuthStateClaims> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

  const locale = payload['locale']

  if (
    typeof payload['businessId'] !== 'string' ||
    typeof payload['platform'] !== 'string' ||
    typeof payload['nonce'] !== 'string' ||
    typeof locale !== 'string' ||
    !VALID_LOCALES.includes(locale as Language)
  ) {
    throw new Error('Invalid OAuth state claims')
  }

  return {
    businessId: payload['businessId'],
    platform: payload['platform'] as Platform,
    nonce: payload['nonce'],
    locale: locale as Language,
  }
}
