import { describe, it, expect } from 'vitest'
import { CAPABILITIES } from './capabilities'

describe('CAPABILITIES', () => {
  it('mirrors the exact capability strings enforced by user_can() (ADR 0013 §4)', () => {
    expect(Object.values(CAPABILITIES).sort()).toEqual(
      [
        'author',
        'reschedule',
        'approve',
        'connect_accounts',
        'manage_members',
        'manage_billing',
      ].sort(),
    )
  })
})
