import { describe, it, expect, vi, beforeEach } from 'vitest'

// Constraint #42 (owner-only, per ruling O-3): the report-email setting is written by the business OWNER, for the
// server-side active business, with a Zod enum, on the authenticated client.

const getUser = vi.hoisted(() => vi.fn())
const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }))
const getBusinessForUser = vi.hoisted(() => vi.fn())
const updateBusiness = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser, updateBusiness }))

import { setReportEmailAction } from './actions'

const OWNER = 'user-owner'
const ADMIN = 'user-admin'
const BUSINESS = { id: 'biz-a', owner_id: OWNER }

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  getUser.mockReset()
  client.auth.getUser = getUser.mockResolvedValue({ data: { user: { id: OWNER } } })
  getBusinessForUser.mockReset().mockResolvedValue(BUSINESS)
  updateBusiness.mockReset().mockResolvedValue({})
  revalidatePath.mockReset()
})

describe('setReportEmailAction', () => {
  it.each(['admins', 'all_members', 'off'])('the owner can set %s: one UPDATE keyed on the active business id, setting only', async (setting) => {
    const state = await setReportEmailAction({}, form({ setting }))
    expect(state).toEqual({ success: true })
    expect(updateBusiness).toHaveBeenCalledTimes(1)
    expect(updateBusiness).toHaveBeenCalledWith(client, 'biz-a', { report_email: setting })
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('a non-owner (an admin member) is rejected as forbidden and nothing is written', async () => {
    getUser.mockResolvedValue({ data: { user: { id: ADMIN } } })
    expect(await setReportEmailAction({}, form({ setting: 'off' }))).toEqual({ error: 'forbidden' })
    expect(updateBusiness).not.toHaveBeenCalled()
  })

  it('an unauthenticated caller and a user with no business are rejected, nothing is written', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await setReportEmailAction({}, form({ setting: 'off' }))).toEqual({ error: 'error' })
    getUser.mockResolvedValue({ data: { user: { id: OWNER } } })
    getBusinessForUser.mockResolvedValue(null)
    expect(await setReportEmailAction({}, form({ setting: 'off' }))).toEqual({ error: 'error' })
    expect(updateBusiness).not.toHaveBeenCalled()
  })

  it.each(['everyone', '', 'ADMINS', 'admins ', 'all'])('rejects the invalid setting %j before any database call', async (setting) => {
    expect(await setReportEmailAction({}, form({ setting }))).toEqual({ error: 'error' })
    expect(getBusinessForUser).not.toHaveBeenCalled()
    expect(updateBusiness).not.toHaveBeenCalled()
  })

  it('a missing setting is rejected', async () => {
    expect(await setReportEmailAction({}, new FormData())).toEqual({ error: 'error' })
    expect(updateBusiness).not.toHaveBeenCalled()
  })

  it('the business comes from the server-side resolver for the SESSION user, never from the form', async () => {
    await setReportEmailAction({}, form({ setting: 'off', businessId: 'biz-evil', business_id: 'biz-evil', id: 'biz-evil', owner_id: 'user-evil' }))
    expect(getBusinessForUser).toHaveBeenCalledWith(client, OWNER)
    expect(updateBusiness).toHaveBeenCalledWith(client, 'biz-a', { report_email: 'off' })
    expect(JSON.stringify(updateBusiness.mock.calls)).not.toContain('evil')
  })

  it('writes nothing but report_email (no plan, owner or other tenancy-critical field can ride along)', async () => {
    await setReportEmailAction({}, form({ setting: 'admins', plan: 'pro', owner_id: 'x', stripe_customer_id: 'cus_x' }))
    expect(Object.keys(updateBusiness.mock.calls[0][2])).toEqual(['report_email'])
  })

  it('a database failure is reported as an error, never as success', async () => {
    updateBusiness.mockRejectedValue(new Error('row-level security'))
    expect(await setReportEmailAction({}, form({ setting: 'off' }))).toEqual({ error: 'error' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
