import { useTranslations } from 'next-intl'
import { format, parseISO } from 'date-fns'
import type { ObservedRowView } from '@/lib/outcomes/campaign-view'

// ADR 0026 §10 (Session 33 J2.12) — the Observed outcomes list, restricted to cells this campaign's posts
// contributed to. A Server Component. Every row states its evidence: a live pattern shows how many posts and
// campaigns stand behind it, a provisional one shows {n} of 10. A pattern is an observation, never a rule, and no
// row carries a multiplier or a causal verb (enforced by copy-lint.test.ts over the copy and the template).

export function ObservedOutcomesList({ rows }: { rows: ObservedRowView[] }) {
  const t = useTranslations('outcome.observed')
  const tPlatform = useTranslations('outcome.platform')

  return (
    <section aria-labelledby="observed-title" className="rounded-lg border border-border bg-card p-6 mb-4 space-y-3">
      <h2 id="observed-title" className="text-base font-semibold tracking-tight">{t('title')}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const platform = tPlatform(row.platform as 'twitter')
            const subject = t(`subject.${row.dimension}.${row.value}` as 'subject.format.single')
            const verb = t(`verb_${row.direction}${row.basis === 'count' ? '_count' : ''}` as 'verb_above')
            return (
              <li key={row.cell} className="space-y-1 py-3 first:pt-0 last:pb-0">
                {row.state === 'live' && (
                  <p className="text-sm text-foreground">
                    {t('live', { platform, subject, verb, wins: row.wins, n: row.n, campaigns: row.campaigns })}
                  </p>
                )}
                {row.state === 'provisional' && (
                  <>
                    <p className="text-sm text-foreground">{t('provisional_line', { platform, subject, verb })}</p>
                    <p className="text-sm text-muted-foreground">{t('provisional', { n: row.n })}</p>
                  </>
                )}
                {row.state === 'contradicted' && (
                  <>
                    <p className="text-sm text-foreground">{t('provisional_line', { platform, subject, verb })}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('contradicted', { date: row.pausedAt ? format(parseISO(row.pausedAt), 'PP') : '' })}
                    </p>
                  </>
                )}
                {row.state === 'no_variety' && (
                  <>
                    <p className="text-sm text-foreground">{platform}: {subject}</p>
                    <p className="text-sm text-muted-foreground">{t('no_variety')}</p>
                  </>
                )}
                {row.platform === 'linkedin' && <p className="text-xs text-muted-foreground">{t('linkedin_basis')}</p>}
                {row.seeded && <p className="text-xs text-muted-foreground">{t('seeded')}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
