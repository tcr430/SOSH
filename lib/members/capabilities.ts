// ADR 0013 §4 — app-layer echo of the capability strings enforced by the
// DB-side user_can(business_id, capability) function. These constants exist so
// call sites reference a name, not a bare string, and so a typo is caught at
// compile time; the DB CASE in user_can() remains the real boundary (L-10).

export const CAPABILITIES = {
  AUTHOR: 'author',
  RESCHEDULE: 'reschedule',
  APPROVE: 'approve',
  CONNECT_ACCOUNTS: 'connect_accounts',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_BILLING: 'manage_billing',
} as const

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]
