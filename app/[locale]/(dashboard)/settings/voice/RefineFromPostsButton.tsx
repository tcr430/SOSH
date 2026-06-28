'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { refineFromPostsAction } from './refine-from-posts-action'

export function RefineFromPostsButton({ hasConnectedAccounts }: { hasConnectedAccounts: boolean }) {
  const t = useTranslations('settings.voice')
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState('')

  async function handleClick() {
    setState('loading')
    const result = await refineFromPostsAction()
    if ('success' in result) {
      setState('success')
      return
    }
    setErrorKey(
      result.error === 'no_connected_accounts' ? 'refine_error_no_accounts' :
      result.error === 'no_posts'              ? 'refine_error_no_posts' :
      result.error === 'trial_cap_reached'     ? 'refine_error_cap' :
                                                 'refine_error_generic',
    )
    setState('error')
  }

  if (!hasConnectedAccounts) {
    return <p className="text-sm text-muted-foreground">{t('refine_error_no_accounts')}</p>
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading' || state === 'success'}
        className="inline-flex items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        {state === 'loading' ? t('refine_loading') :
         state === 'success' ? t('refine_success') :
                               t('refine_cta')}
      </button>
      {state === 'error' && (
        <p className="text-sm text-destructive">{t(errorKey as Parameters<typeof t>[0])}</p>
      )}
    </div>
  )
}
