'use client'

import { useFormStatus } from 'react-dom'

export function SkipButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  )
}
