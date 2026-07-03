import { SignJWT, jwtVerify } from 'jose'
import { config } from '@/lib/config'

export interface InviteTokenClaims {
  memberId: string
  businessId: string
}

function getSecret(): Uint8Array {
  const raw = config.server.INVITE_TOKEN_SECRET
  if (!raw || raw.length < 32) {
    throw new Error(
      'INVITE_TOKEN_SECRET must be set to at least 32 characters before using invite flows',
    )
  }
  return new TextEncoder().encode(raw)
}

export async function signInviteToken(input: InviteTokenClaims): Promise<string> {
  return new SignJWT({ memberId: input.memberId, businessId: input.businessId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyInviteToken(token: string): Promise<InviteTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

  if (typeof payload['memberId'] !== 'string' || typeof payload['businessId'] !== 'string') {
    throw new Error('Invalid invite token claims')
  }

  return {
    memberId: payload['memberId'],
    businessId: payload['businessId'],
  }
}
