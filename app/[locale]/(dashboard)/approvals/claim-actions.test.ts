import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0027 §4.8 — Session 34-D D6 (MAJOR-2). resolveClaimAction, exercised for real: ClaimFlags.test.tsx and
// ApprovalsInbox.test.tsx mock it, so before this file letting it accept ANY evidence id (or write a post's text)
// would have shipped green. The properties (AGENCY-CLAIMS-FLAGGED-NEVER-EDITED, "cite SELECTS, never creates"):
//   * `cited` LINKS an EXISTING evidence_memory row: the id must be in the business-scoped, capped retrieval the
//     picker offered — a guessed or pasted id is refused and NOTHING is written;
//   * `accepted` / `dismissed` record a human resolution beside the claim;
//   * NO resolution ever writes posts.content — the only write is setPostClaimResolution, and this module has no
//     other posts writer to reach (the fourth §4.8 action, EDIT THE TEXT, is the existing post-edit path: a link).
//
// SHARED-FUNCTION CALLERS: resolveClaimAction has ONE caller, ClaimFlags.tsx (mocked in ClaimFlags.test.tsx and
// ApprovalsInbox.test.tsx, which cite THIS file). setPostClaimResolution's DB behaviour: lib/db/posts.claims.test.ts.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
// ONLY the two functions this module may use. A third posts function reached by the action would be undefined here
// and fail the run — the "never writes posts.content" property is enforced by what is exposed, plus the scan below.
vi.mock('@/lib/db/posts', () => ({ getPostById: vi.fn(), setPostClaimResolution: vi.fn() }))
vi.mock('@/lib/memory', () => ({ retrieveEvidenceMemory: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { resolveClaimAction } from './claim-actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getPostById, setPostClaimResolution } from '@/lib/db/posts'
import { retrieveEvidenceMemory } from '@/lib/memory'
import { CLAIMS_MAX } from '@/lib/ai/prompts/formats/schemas'
import type { BusinessRow } from '@/lib/db/types'

const POST_ID = '11111111-1111-4111-8111-111111111111'
const OFFERED_ID = '22222222-2222-4222-8222-222222222222'
const GUESSED_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = 'user-owner'
const BUSINESS = { id: 'biz-1', owner_id: USER_ID } as BusinessRow

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const run = (fields: Record<string, string>) => resolveClaimAction({ status: 'idle' }, formDataOf({ postId: POST_ID, claimIndex: '0', ...fields }))

function signIn(userId = USER_ID) {
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) } }
  vi.mocked(createClient).mockResolvedValue(client as never)
  return client
}

let client: ReturnType<typeof signIn>

beforeEach(() => {
  vi.clearAllMocks()
  client = signIn()
  vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS)
  vi.mocked(getPostById).mockResolvedValue({ id: POST_ID, business_id: 'biz-1', content: 'We cut churn by 42%.' } as never)
  vi.mocked(retrieveEvidenceMemory).mockResolvedValue([{ id: OFFERED_ID }] as never)
  vi.mocked(setPostClaimResolution).mockResolvedValue('ok' as never)
})

describe('resolveClaimAction — input, auth and ownership', () => {
  it('refuses malformed input and writes nothing', async () => {
    const bad: Array<Record<string, string>> = [
      { postId: 'nope', resolution: 'accepted' },
      { resolution: 'edited' }, // the fourth §4.8 action is the post-edit path, not a resolution here
      { claimIndex: String(CLAIMS_MAX), resolution: 'accepted' },
      { claimIndex: '-1', resolution: 'accepted' },
      { resolution: 'cited' }, // cited WITHOUT an evidence id
      { resolution: 'accepted', evidenceMemoryId: OFFERED_ID }, // an evidence id on a non-cited resolution
    ]
    for (const fields of bad) expect(await run(fields)).toEqual({ status: 'error', error: 'invalid_input' })
    expect(setPostClaimResolution).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } } as never)
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'unauthorized' })
    expect(setPostClaimResolution).not.toHaveBeenCalled()
  })

  it('CAPABILITY refusal: a viewer (no approve capability, not admin) is refused `forbidden` and nothing is written', async () => {
    signIn('user-viewer')
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'forbidden' })
    expect(setPostClaimResolution).not.toHaveBeenCalled()
  })

  it("refuses a post that is not the caller's business's (`not_found`) and writes nothing", async () => {
    vi.mocked(getPostById).mockResolvedValue({ id: POST_ID, business_id: 'someone-else' } as never)
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'not_found' })
    vi.mocked(getPostById).mockRejectedValue(new Error('no row'))
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'not_found' })
    expect(setPostClaimResolution).not.toHaveBeenCalled()
  })
})

describe('resolveClaimAction — "cite SELECTS, never creates" (§4.8, AGENCY-CLAIMS-FLAGGED-NEVER-EDITED)', () => {
  it('an evidence id that is NOT in the business-scoped retrieval set is refused `unknown_evidence` — and NOTHING is written', async () => {
    const result = await run({ resolution: 'cited', evidenceMemoryId: GUESSED_ID })
    expect(result).toEqual({ status: 'error', error: 'unknown_evidence', postId: POST_ID })
    expect(setPostClaimResolution).not.toHaveBeenCalled()
  })

  it("the membership set is the caller-scoped retrieval: the caller's client, THIS business, no query context", async () => {
    await run({ resolution: 'cited', evidenceMemoryId: OFFERED_ID })
    expect(retrieveEvidenceMemory).toHaveBeenCalledTimes(1)
    expect(retrieveEvidenceMemory).toHaveBeenCalledWith(client, 'biz-1', {})
  })

  it('an id that IS in the offered set records the resolution, linking that EXISTING row', async () => {
    const result = await run({ resolution: 'cited', evidenceMemoryId: OFFERED_ID, claimIndex: '2' })

    expect(result).toEqual({ status: 'resolved', postId: POST_ID, claimIndex: 2, resolution: 'cited' })
    expect(setPostClaimResolution).toHaveBeenCalledTimes(1)
    expect(setPostClaimResolution).toHaveBeenCalledWith(client, POST_ID, 2, {
      kind: 'cited',
      evidenceMemoryId: OFFERED_ID,
      at: expect.any(String),
      by: USER_ID,
    })
  })
})

describe('resolveClaimAction — accepted and dismissed record a human resolution; no evidence lookup, no text write', () => {
  it.each(['accepted', 'dismissed'] as const)('%s records {kind, at, by} beside the claim and does NOT consult evidence memory', async (resolution) => {
    const result = await run({ resolution, claimIndex: '1' })

    expect(result).toEqual({ status: 'resolved', postId: POST_ID, claimIndex: 1, resolution })
    expect(setPostClaimResolution).toHaveBeenCalledTimes(1)
    expect(setPostClaimResolution).toHaveBeenCalledWith(client, POST_ID, 1, { kind: resolution, at: expect.any(String), by: USER_ID })
    expect(retrieveEvidenceMemory).not.toHaveBeenCalled()
  })

  it('an unresolvable claim (`no_such_claim`) reads as invalid input; conflict / not_checked / not_found pass through with the post id', async () => {
    vi.mocked(setPostClaimResolution).mockResolvedValue('no_such_claim' as never)
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'invalid_input', postId: POST_ID })
    for (const outcome of ['conflict', 'not_checked', 'not_found'] as const) {
      vi.mocked(setPostClaimResolution).mockResolvedValue(outcome as never)
      expect(await run({ resolution: 'dismissed' })).toEqual({ status: 'error', error: outcome, postId: POST_ID })
    }
  })

  it('a thrown error is a generic error, never an unhandled rejection', async () => {
    vi.mocked(setPostClaimResolution).mockRejectedValue(new Error('boom'))
    expect(await run({ resolution: 'accepted' })).toEqual({ status: 'error', error: 'generic' })
  })
})

describe("AGENCY-CLAIMS-FLAGGED-NEVER-EDITED — the module has no way to write a post's text", () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/[locale]/(dashboard)/approvals/claim-actions.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the only posts functions it imports are the reader and the claim-resolution writer', () => {
    const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/db\/posts'/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()))
    expect(imports.sort()).toEqual(['getPostById', 'setPostClaimResolution'])
  })

  it('it issues no PostgREST write and never names the content column as a write target', () => {
    expect(code).not.toMatch(/\.(update|insert|upsert|delete)\s*\(/)
    expect(code).not.toMatch(/updatePostContent|content\s*:/)
  })
})
