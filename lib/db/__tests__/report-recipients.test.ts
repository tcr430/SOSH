import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0031 §5.4, REPORT-MEMBERS-ONLY (Tier-2 half). resolveReportRecipients is the ONE source of a report email's
// address: the member row, for ONE business, active and bound to a user. The fake below applies the filters the
// function asks for to an in-memory table, so a dropped filter changes the result and the test goes red.

interface Row {
  id: string
  business_id: string
  user_id: string | null
  email: string
  is_admin: boolean
  status: 'invited' | 'active' | 'revoked'
  created_at: string
}

const table: { rows: Row[] } = vi.hoisted(() => ({ rows: [] }))
const calls = vi.hoisted(() => ({ limit: undefined as number | undefined, order: undefined as string | undefined, from: [] as string[] }))

function builder() {
  const filters: Array<(r: Row) => boolean> = []
  const q = {
    select: () => q,
    eq: (col: keyof Row, val: unknown) => (filters.push((r) => r[col] === val), q),
    not: (col: keyof Row, op: string, val: unknown) => {
      if (op !== 'is') throw new Error('fake supports not(col, "is", value) only')
      filters.push((r) => r[col] !== val)
      return q
    },
    order: (col: string) => ((calls.order = col), q),
    limit: (n: number) => ((calls.limit = n), q),
    then: (resolve: (v: { data: Array<Pick<Row, 'id' | 'email'>>; error: null }) => void) => {
      const out = table.rows
        .filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, calls.limit ?? Infinity)
        .map((r) => ({ id: r.id, email: r.email }))
      resolve({ data: out, error: null })
    },
  }
  return q
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    from: (name: string) => {
      calls.from.push(name)
      return builder()
    },
  }),
}))

import { resolveReportRecipients, REPORT_RECIPIENT_MAX } from '../business-members'

const A = 'biz-a'
const B = 'biz-b'
let n = 0
function member(over: Partial<Row>): Row {
  n += 1
  return {
    id: `m${n}`,
    business_id: A,
    user_id: `u${n}`,
    email: `m${n}@example.com`,
    is_admin: false,
    status: 'active',
    created_at: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`,
    ...over,
  }
}

beforeEach(() => {
  n = 0
  calls.limit = undefined
  calls.order = undefined
  calls.from.length = 0
  table.rows = [
    member({ id: 'owner', is_admin: true, email: 'owner@example.com' }),
    member({ id: 'admin2', is_admin: true, email: 'admin2@example.com' }),
    member({ id: 'editor', is_admin: false, email: 'editor@example.com' }),
    member({ id: 'invited', status: 'invited', user_id: null, is_admin: true, email: 'invited@example.com' }),
    member({ id: 'revoked', status: 'revoked', is_admin: true, email: 'revoked@example.com' }),
    member({ id: 'unbound', user_id: null, is_admin: true, email: 'unbound@example.com' }),
    member({ id: 'other-biz', business_id: B, is_admin: true, email: 'other@example.com' }),
  ]
})

describe("resolveReportRecipients('admins')", () => {
  it('returns the active, user-bound admins of THIS business, owner included, and nobody else', async () => {
    const got = await resolveReportRecipients(A, 'admins')
    expect(got.map((r) => r.id)).toEqual(['owner', 'admin2'])
  })

  it('excludes invited, revoked and unbound members and a non-admin', async () => {
    const ids = (await resolveReportRecipients(A, 'admins')).map((r) => r.id)
    for (const excluded of ['invited', 'revoked', 'unbound', 'editor']) expect(ids).not.toContain(excluded)
  })

  it("never returns another business's member", async () => {
    expect((await resolveReportRecipients(A, 'admins')).map((r) => r.id)).not.toContain('other-biz')
    expect((await resolveReportRecipients(B, 'admins')).map((r) => r.id)).toEqual(['other-biz'])
  })

  it('reads the address from the member row (id and email only, nothing else leaves the function)', async () => {
    const [first] = await resolveReportRecipients(A, 'admins')
    expect(Object.keys(first).sort()).toEqual(['email', 'id'])
    expect(first.email).toBe('owner@example.com')
  })
})

describe("resolveReportRecipients('all_members')", () => {
  it('widens to every active, user-bound member of the business (non-admins included), still excluding invited, revoked and unbound', async () => {
    const ids = (await resolveReportRecipients(A, 'all_members')).map((r) => r.id)
    expect(ids).toEqual(['owner', 'admin2', 'editor'])
  })
})

describe("resolveReportRecipients('off') and an unknown value", () => {
  it("'off' returns nobody and does not touch the database", async () => {
    expect(await resolveReportRecipients(A, 'off')).toEqual([])
    expect(calls.from).toEqual([])
  })

  it('an unrecognised setting fails CLOSED: nobody, no query', async () => {
    expect(await resolveReportRecipients(A, 'everyone' as never)).toEqual([])
    expect(calls.from).toEqual([])
  })
})

describe('bounded and ordered', () => {
  it('applies an explicit limit and a created_at order (the list is never unbounded)', async () => {
    await resolveReportRecipients(A, 'admins')
    expect(calls.limit).toBe(REPORT_RECIPIENT_MAX)
    expect(calls.order).toBe('created_at')
    expect(REPORT_RECIPIENT_MAX).toBeGreaterThan(0)
  })
})
