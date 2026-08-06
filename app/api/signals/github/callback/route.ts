import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getBusinessById } from '@/lib/db/businesses'
import { canServer } from '@/lib/members/can-server'
import { CAPABILITIES } from '@/lib/members/capabilities'
import { upsertGithubConnection } from '@/lib/db/github-connections'
import { verifyGithubConnectState } from '@/lib/signals/state'
import { exchangeUserCode, getUserInstallations } from '@/lib/signals'

// ADR 0020 §8.3 — the eleven-step install callback. §8.2 names the exact
// vulnerability this file exists to close: `installation_id` is a bare,
// GitHub-unsigned integer, so verifying it EXISTS (a liveness check) is not
// the same as verifying the signed-in user can ADMINISTER it (the actual
// authorization boundary). Step 9 (GET /user/installations) is that proof;
// nothing before it is sufficient on its own, and skipping it lets an
// attacker bind a stranger's installation — including private-repo release
// notes — to a business they control, and squat it permanently via the
// UNIQUE(installation_id) arbiter.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

export const NONCE_COOKIE_NAME = 'github_connect_nonce'

// Step 1 — Zod on every query param (L-13). installation_id arrives as a
// numeric string; setup_action is GitHub's own three-value enum. `code` is
// optional at the SHAPE level because setup_action='request' never carries
// one — its presence is enforced explicitly, only on the 'install' branch,
// after step 7.
const callbackParamsSchema = z.object({
  installation_id: z.string().regex(/^\d+$/, 'installation_id must be numeric').transform(Number),
  setup_action: z.enum(['install', 'update', 'request']),
  state: z.string().min(1),
  code: z.string().min(1).optional(),
})

function redirectTo(request: NextRequest, path: string, params: Record<string, string> = {}): NextResponse {
  const url = new URL(path, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

// Every redirect issued AFTER the nonce has been successfully matched
// against the state claim (step 3) clears the cookie through this
// wrapper — the nonce is "spent" the instant it validates, regardless of
// what any LATER step (steps 4-11) decides.
function redirectClearingNonce(response: NextResponse): NextResponse {
  response.cookies.delete(NONCE_COOKIE_NAME)
  return response
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams

  // Step 1
  const parsed = callbackParamsSchema.safeParse({
    installation_id: searchParams.get('installation_id'),
    setup_action: searchParams.get('setup_action'),
    state: searchParams.get('state'),
    code: searchParams.get('code') ?? undefined,
  })
  if (!parsed.success) {
    return redirectTo(request, '/en/settings/signals', { error: 'invalid_request' })
  }
  const { installation_id: installationId, setup_action: setupAction, state: stateParam, code } = parsed.data

  // Step 2
  let claims
  try {
    claims = await verifyGithubConnectState(stateParam)
  } catch {
    return redirectTo(request, '/en/settings/signals', { error: 'invalid_state' })
  }

  // Step 3 — single-use nonce, no new table: the httpOnly cookie the
  // connect action set must equal the JWT's own nonce claim. A missing
  // cookie (never set, already cleared by a prior attempt, or expired past
  // its 5-minute lifetime) and a mismatched cookie are the SAME rejection —
  // both mean "this state was not the one this browser was issued, or it
  // was already redeemed."
  const nonceCookie = request.cookies.get(NONCE_COOKIE_NAME)?.value
  if (!nonceCookie || nonceCookie !== claims.nonce) {
    return redirectTo(request, '/en/settings/signals', { error: 'invalid_state' })
  }

  // Step 4 — the business comes ONLY from the signed state, never a query
  // param; UUID-shape checked before any use.
  if (!isValidUUID(claims.businessId)) {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'invalid_state' }))
  }

  // Step 5 — re-fetch under the ANON, RLS-enforced client, proving the
  // CURRENTLY signed-in user still has access. If the session expired
  // during GitHub's install detour, this cannot complete — redirect to
  // login preserving this exact callback URL, and write nothing (the
  // 5-minute nonce cookie already bounds how stale that redirect can be).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const next = encodeURIComponent(`${request.nextUrl.pathname}${request.nextUrl.search}`)
    return redirectClearingNonce(NextResponse.redirect(new URL(`/en/login?next=${next}`, request.url)))
  }
  // The state also binds userId ([sec-MEDIUM-7]): the signed-in user must
  // be the SAME one who started this flow, not merely any member able to
  // read the target business.
  if (user.id !== claims.userId) {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'forbidden' }))
  }

  let business
  try {
    business = await getBusinessById(supabase, claims.businessId)
  } catch {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'forbidden' }))
  }

  // Step 6 — the authoritative gate (ADR 0014 §7 / the 21B precedent,
  // app/api/social/[platform]/connect/route.ts:39-45): this handler writes
  // SERVICE-ROLE below, so RLS is defence-in-depth here, not the boundary —
  // this app-layer check is.
  if (!(await canServer(supabase, business, user.id, CAPABILITIES.CONNECT_ACCOUNTS))) {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'forbidden' }))
  }

  // Step 7 — [sec-HIGH-2]. ONLY 'install' proceeds. 'request' means a
  // non-admin org member triggered the install and owner approval is
  // pending — there is no installation to bind yet. 'update' (the
  // installer changed which repos the App can see, from GitHub's own UI)
  // needs no SOSH-side write either: the watch list is managed through
  // SOSH's own UI, not GitHub's picker.
  if (setupAction === 'request') {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { awaiting_approval: '1' }))
  }
  if (setupAction !== 'install') {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', {}))
  }
  if (!code) {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'invalid_request' }))
  }

  // Step 8 — exchange the OAuth code for a user access token, in memory.
  let userToken: string
  try {
    const exchanged = await exchangeUserCode(code)
    userToken = exchanged.accessToken
  } catch {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'exchange_failed' }))
  }

  // Step 9 — THE TENANT BINDING (§8.2, A-1). Bind only if installationId
  // appears in the AUTHENTICATED USER'S OWN installation list. This is the
  // ONLY check in this file that proves ownership rather than mere
  // existence, and it is what closes both the tenant-confusion BLOCKER and
  // the installation-squatting DoS (you cannot squat what you cannot
  // administer).
  let matchedInstallation
  try {
    const installations = await getUserInstallations(userToken)
    matchedInstallation = installations.find((i) => i.id === installationId)
  } catch {
    // Step 10 (early exit) — userToken goes out of scope here regardless;
    // never persisted, never logged, never reused.
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'exchange_failed' }))
  }
  // Step 10 — discard the user token. It is used for exactly the one call
  // above and never referenced again below this line.
  if (!matchedInstallation) {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'not_your_installation' }))
  }

  // Step 11 — upsert under UNIQUE(installation_id); a conflict against a
  // DIFFERENT business is a typed error, never a silent rebind.
  const accountLogin = matchedInstallation.account?.login ?? String(installationId)
  const result = await upsertGithubConnection({
    business_id: business.id,
    installation_id: installationId,
    account_login: accountLogin,
    is_active: true,
  })
  if (result.status === 'conflict') {
    return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { error: 'already_connected' }))
  }

  return redirectClearingNonce(redirectTo(request, '/en/settings/signals', { connected: 'github' }))
}
