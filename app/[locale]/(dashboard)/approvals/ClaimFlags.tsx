'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resolveClaimAction, type ResolveClaimState } from './claim-actions'
import type { PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.6/§4.8/§8 (Session 34 K2.10) — claim flags at the EXISTING post approval gate (the approvals inbox).
// No new surface.
//
// VOCABULARY IS A PRODUCT-SAFETY REQUIREMENT: this surface says "cited", never "verified" or "supported".
// Verification proves PROVENANCE (the cited id was in the set sent to the model), not that the sentence follows
// from that evidence; a founder reads a green tick as an editorial guarantee. So there is NO tick, NO green, NO
// badge for the good case — "cited" is quiet text — and the one-line explainer says what it does and does not mean.
// The internal outcome word `supported` is never rendered. (agency-parity.test.ts + the surface test enforce it.)
//
// EVERY RENDERED BYTE COMES FROM THE POST. A flagged sentence is a SPAN (start/end offsets) into the post's own
// text — never the model's `claim.text` string, which is not persisted at all — and a fabricated citation's id is
// never persisted or shown. Everything is a React text node: no markdown, no HTML.
//
// THE SYSTEM NEVER TOUCHES THE TEXT. The four actions are all HUMAN: accept as written, edit (a link to the
// existing post-edit path), cite EXISTING evidence (selects, never creates), dismiss.
//
// The states (§8.2) are separately legible: not checked · no claims · no evidence corpus (claims not checked) ·
// all cited · n flagged. Absence of a verdict is "not checked", never "clean".

export type EvidenceOption = { id: string; snippet: string }

type CheckedClaim = Extract<PersistedClaimCheck, { status: 'checked' }>['claims'][number]

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const isFlagged = (c: CheckedClaim) => c.outcome !== 'supported'
const isOpen = (c: CheckedClaim) => isFlagged(c) && !c.resolution

export function hasOpenClaimFlags(check: PersistedClaimCheck | undefined): boolean {
  return check?.status === 'checked' && check.claims.some(isOpen)
}

// The post's own text with each OPEN flagged sentence marked inline. Spans are clamped and de-overlapped; a claim
// whose text was not found verbatim (span null) is simply not highlightable here (it is still listed below).
export function MarkedPostText({ content, check }: { content: string; check: PersistedClaimCheck | undefined }) {
  const t = useTranslations('agency.claims')
  if (check?.status !== 'checked') return <p className="text-sm leading-relaxed">{content}</p>

  const spans = check.claims
    .filter(isOpen)
    .flatMap((c) => (c.span ? [c.span] : []))
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(content.length, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  const parts: Array<{ text: string; marked: boolean }> = []
  let cursor = 0
  for (const s of spans) {
    if (s.start < cursor) continue // overlapping: the earlier span already covers it
    if (s.start > cursor) parts.push({ text: content.slice(cursor, s.start), marked: false })
    parts.push({ text: content.slice(s.start, s.end), marked: true })
    cursor = s.end
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), marked: false })

  return (
    <p className="whitespace-pre-line text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.marked ? (
          // Marked by an underline AND a screen-reader prefix, never by colour alone.
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 underline decoration-dotted underline-offset-2 dark:bg-amber-950/50">
            <span className="sr-only">{t('flagged_mark')}: </span>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  )
}

interface ClaimFlagsProps {
  postId: string
  content: string
  check: PersistedClaimCheck | undefined
  evidenceOptions: EvidenceOption[]
  // The EXISTING post-edit path (a link out, never an action here).
  editHref: string
}

export function ClaimFlags({ postId, content, check, evidenceOptions, editHref }: ClaimFlagsProps) {
  const t = useTranslations('agency.claims')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(resolveClaimAction, { status: 'idle' } as ResolveClaimState)

  useEffect(() => {
    if (state.status === 'resolved') router.refresh()
  }, [state.status, router])

  // ── The states that have nothing to flag. Each is its own sentence. ──
  if (!check) return <p className="mt-2 text-xs text-muted-foreground">{t('not_checked')}</p>
  if (check.status !== 'checked') {
    // 'no_claims' and 'no_corpus' are DIFFERENT sentences — "nothing to check" is not "nothing to check against".
    return <p className="mt-2 text-xs text-muted-foreground">{check.status === 'no_corpus' ? t('no_corpus') : t('no_claims')}</p>
  }

  const flagged = check.claims.map((c, index) => ({ c, index })).filter(({ c }) => isFlagged(c))
  if (flagged.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{t('all_cited', { count: check.claims.length })}</p>
  }

  const cited = check.claims.filter((c) => c.outcome === 'supported').length
  const uncited = check.claims.filter((c) => c.outcome === 'unsupported').length
  const unknown = check.claims.filter((c) => c.outcome === 'fabricated').length
  const open = flagged.filter(({ c }) => !c.resolution)
  const resolved = flagged.filter(({ c }) => c.resolution)

  const sentence = (c: CheckedClaim) => (c.span ? content.slice(c.span.start, c.span.end) : null)

  return (
    <section aria-label={t('heading')} className="mt-3 space-y-2 text-sm">
      <p className="text-xs font-medium">{t('summary', { cited, uncited, unknown })}</p>
      {/* ONE line: what "cited" means, and what it does not. */}
      <p className="text-xs text-muted-foreground">{t('cited_explainer')}</p>

      {open.length > 0 && (
        // Hairlines only: this sits INSIDE the row's own card, and a bordered rounded box in a bordered card is a nested card.
        <ul className="divide-y divide-border border-y border-border">
          {open.map(({ c, index }) => {
            const text = sentence(c)
            return (
              <li key={index} className="space-y-2 p-3">
                <p>
                  <span className="font-medium">{c.outcome === 'fabricated' ? t('cited_unknown') : t('uncited')}</span>
                  {text ? <span className="text-muted-foreground">: {text}</span> : <span className="block text-xs text-muted-foreground">{t('unlocated')}</span>}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={formAction}>
                    <input type="hidden" name="postId" value={postId} />
                    <input type="hidden" name="claimIndex" value={index} />
                    <button type="submit" name="resolution" value="accepted" disabled={pending} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), focusRing, 'disabled:opacity-50')}>
                      {t('actions.accept')}
                    </button>
                  </form>
                  <Link href={editHref} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), focusRing)}>
                    {t('actions.edit')}
                  </Link>
                  <form action={formAction}>
                    <input type="hidden" name="postId" value={postId} />
                    <input type="hidden" name="claimIndex" value={index} />
                    <button type="submit" name="resolution" value="dismissed" disabled={pending} className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), focusRing, 'text-muted-foreground disabled:opacity-50')}>
                      {t('actions.dismiss')}
                    </button>
                  </form>
                </div>
                {/* Cite EXISTING evidence: a native disclosure, so it works without JS and is keyboard-native. */}
                <details className="text-xs">
                  <summary className={cn('cursor-pointer rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground', focusRing)}>
                    {t('actions.cite')}
                  </summary>
                  {evidenceOptions.length === 0 ? (
                    <p className="mt-2 text-muted-foreground">{t('cite.empty')}</p>
                  ) : (
                    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="postId" value={postId} />
                      <input type="hidden" name="claimIndex" value={index} />
                      <label className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-medium">{t('cite.label')}</span>
                        <select name="evidenceMemoryId" required defaultValue="" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          <option value="" disabled />
                          {evidenceOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.snippet}</option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" name="resolution" value="cited" disabled={pending} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), focusRing, 'disabled:opacity-50')}>
                        {t('cite.submit')}
                      </button>
                    </form>
                  )}
                </details>
              </li>
            )
          })}
        </ul>
      )}

      {resolved.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {resolved.map(({ c, index }) => (
            <li key={index}>{t(`resolved.${c.resolution!.kind}`)}</li>
          ))}
        </ul>
      )}

      {state.status === 'error' && (state.postId === undefined || state.postId === postId) && (
        <p role="alert" className="text-xs text-destructive">{t(`error.${state.error}`)}</p>
      )}
    </section>
  )
}
