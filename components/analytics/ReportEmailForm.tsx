'use client'

import { useActionState } from 'react'

// ADR 0031 §10.6 — the report-email setting: the second (and last) client island besides error.tsx. A native <select> in a
// form with `useActionState`. Every word arrives as a prop from the server page (the strings are already translated), and
// the Server Action arrives the same way, so this file holds no copy and imports nothing from app/.

type Setting = 'admins' | 'all_members' | 'off'
interface State {
  success?: boolean
  error?: 'error' | 'forbidden'
}

export interface ReportEmailFormLabels {
  label: string
  help: string
  save: string
  saved: string
  error: string
  forbidden: string
  options: Record<Setting, string>
}

const SELECT = 'min-h-8 rounded-md border bg-background px-3 py-2 text-sm'
const BUTTON = 'min-h-8 rounded-md border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground'

export function ReportEmailForm({
  action,
  current,
  labels,
}: {
  action: (prev: State, formData: FormData) => Promise<State>
  current: Setting
  labels: ReportEmailFormLabels
}) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="report-email-setting" className="text-xs font-medium text-muted-foreground">
            {labels.label}
          </label>
          <select id="report-email-setting" name="setting" defaultValue={current} className={SELECT} aria-describedby="report-email-help">
            {(Object.keys(labels.options) as Setting[]).map((value) => (
              <option key={value} value={value}>
                {labels.options[value]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {labels.save}
        </button>
      </div>
      <p id="report-email-help" className="text-xs text-muted-foreground">
        {labels.help}
      </p>
      <p role="status" aria-live="polite" className={state.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {state.success ? labels.saved : state.error === 'forbidden' ? labels.forbidden : state.error ? labels.error : ''}
      </p>
    </form>
  )
}
