// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
}))

vi.mock('./actions', () => ({
  signupAction: vi.fn(),
}))

import { SignupForm } from './SignupForm'

function renderForm(invite: Parameters<typeof SignupForm>[0]['invite']) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(SignupForm, { invite }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe('SignupForm — INV-SIGNUP-EMAIL-LOCKED', () => {
  it('renders the email field editable and the company field present when there is no invite', () => {
    const { container, cleanup } = renderForm(null)
    const email = container.querySelector('#email') as HTMLInputElement
    const company = container.querySelector('#company') as HTMLInputElement | null
    const token = container.querySelector('input[name="token"]')

    expect(email.readOnly).toBe(false)
    expect(company).not.toBeNull()
    expect(token).toBeNull()

    cleanup()
  })

  it('locks the email field to the invited address and hides the company field when an invite is present', () => {
    const invite = { token: 'signed-jwt', email: 'invitee@company.com', businessName: 'Acme Corp' }
    const { container, cleanup } = renderForm(invite)

    const email = container.querySelector('#email') as HTMLInputElement
    const company = container.querySelector('#company')
    const tokenInput = container.querySelector('input[name="token"]') as HTMLInputElement

    expect(email.readOnly).toBe(true)
    expect(email.value).toBe('invitee@company.com')
    expect(company).toBeNull()
    expect(tokenInput).not.toBeNull()
    expect(tokenInput.value).toBe('signed-jwt')

    cleanup()
  })

  it('the invited email cannot be edited via user input (readOnly, not just visually styled)', () => {
    const invite = { token: 'signed-jwt', email: 'invitee@company.com', businessName: 'Acme Corp' }
    const { container, cleanup } = renderForm(invite)

    const email = container.querySelector('#email') as HTMLInputElement
    expect(email.hasAttribute('readonly')).toBe(true)

    cleanup()
  })
})
