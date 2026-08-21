// ADR 0020 §8.3 steps 2-3 — the GitHub connect flow's signed state, mirroring
// lib/social/oauth/state.ts's shape (jose HS256, the same OAUTH_STATE_SECRET
// — no new secret invented for a second, structurally identical mechanism).
// Two differences from the social flow, both load-bearing here specifically:
//   - Claims bind userId as well as businessId ([sec-MEDIUM-7]) — the
//     callback requires the signed-in user to MATCH it, not just any member
//     of the business.
//   - A 5-minute expiry, not 10 — this state is redeemed synchronously
//     through a single external redirect (GitHub's install flow), not a
//     longer OAuth consent detour.
// The nonce itself is single-use via a SEPARATE httpOnly cookie the connect
// action sets and the callback clears (§8.3 step 3) — the JWT's own
// expiry only bounds the window, it does not make the nonce single-use by
// itself.

import { SignJWT, jwtVerify } from 'jose'
import { config } from '@/lib/config'

export interface GithubConnectStateClaims {
  businessId: string
  userId: string
  nonce: string
}

function getSecret(): Uint8Array {
  const raw = config.server.OAUTH_STATE_SECRET
  if (!raw || raw.length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be set to at least 32 characters before using the GitHub connect flow')
  }
  return new TextEncoder().encode(raw)
}

export async function signGithubConnectState(input: { businessId: string; userId: string }): Promise<{
  state: string
  nonce: string
}> {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')
  const state = await new SignJWT({ businessId: input.businessId, userId: input.userId, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret())
  return { state, nonce }
}

export async function verifyGithubConnectState(token: string): Promise<GithubConnectStateClaims> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })

  if (
    typeof payload['businessId'] !== 'string' ||
    typeof payload['userId'] !== 'string' ||
    typeof payload['nonce'] !== 'string'
  ) {
    throw new Error('Invalid GitHub connect state claims')
  }

  return {
    businessId: payload['businessId'],
    userId: payload['userId'],
    nonce: payload['nonce'],
  }
}
