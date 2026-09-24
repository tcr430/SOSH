import { useTranslations } from 'next-intl'
import { format, parseISO } from 'date-fns'
import type { CampaignRetrospectiveRow } from '@/lib/db/types'
import { AcknowledgeForm } from './AcknowledgeForm'

// ADR 0026 §10 (Session 33 J2.12) — the Retrospective card. A Server Component: it only DISPLAYS a result the
// worker computed. Every §10.2 state is rendered with its copy obligation, and the honesty line ("engagement on
// {platform}, not signups or revenue") is always present. No new colour: only existing tokens.
//
// Design (taste-skill, adapted to in-app UI): the card leads with the plain-language verdict, the number of posts
// sits directly beside every rate, and the disclosures stay quiet underneath. No badges, dots or decoration.

export interface RetrospectiveCardProps {
  retro: CampaignRetrospectiveRow | null
  dueAt: string | null
  // Display names of the campaign's platforms, already localised ("X, LinkedIn").
  platformNames: string
  // Display names of platforms whose metrics are unavailable.
  unavailablePlatformNames: string[]
  campaignId: string
  currentUserId: string
}

type RoleCell = { n: number; wins: number }

function roleCells(byRole: Record<string, unknown>): Array<[string, RoleCell]> {
  return Object.entries(byRole).flatMap(([role, cell]) => {
    const c = cell as Partial<RoleCell> | null
    return c && typeof c.n === 'number' && typeof c.wins === 'number' ? [[role, { n: c.n, wins: c.wins }] as [string, RoleCell]] : []
  })
}

const ROLES = new Set(['anchor_thesis', 'founder_perspective', 'customer_proof', 'objection_response', 'conversation_starter', 'follow_up'])

export function RetrospectiveCard({ retro, dueAt, platformNames, unavailablePlatformNames, campaignId, currentUserId }: RetrospectiveCardProps) {
  const t = useTranslations('outcome.retrospective')
  const tRole = useTranslations('outcome.role')

  const conclusive = retro !== null && retro.verdict !== 'inconclusive'

  return (
    <section aria-labelledby="retrospective-title" className="rounded-lg border border-border bg-card p-6 mb-4 space-y-4">
      <h2 id="retrospective-title" className="text-base font-semibold tracking-tight">{t('title')}</h2>

      {retro === null && (
        <p className="text-sm text-foreground">
          {dueAt ? t('not_due', { date: format(parseISO(dueAt), 'PP') }) : t('not_due_pending')}
        </p>
      )}

      {retro !== null && retro.verdict === 'inconclusive' && (
        <p className="text-sm text-foreground">{t('inconclusive', { n: retro.n })}</p>
      )}

      {retro !== null && conclusive && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t('hypothesis_label')}</h3>
            <p className="text-sm text-foreground leading-relaxed break-words">
              {retro.hypothesis_source === 'implicit' ? t('hypothesis_implicit') : retro.hypothesis_snapshot}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-lg font-medium text-foreground">
              {retro.verdict === 'supported' ? t('verdict_supported') : t('verdict_not_supported')}
            </p>
            <p className="text-sm text-foreground">{t('posts_beat', { wins: retro.wins, n: retro.n })}</p>
            {retro.interval_low !== null && retro.interval_high !== null && (
              <p className="text-sm text-muted-foreground">
                {t('interval', { n: retro.n, low: Number(retro.interval_low).toFixed(2), high: Number(retro.interval_high).toFixed(2) })}
              </p>
            )}
          </div>

          {roleCells(retro.by_role).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{t('by_role_title')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-1 pr-4 font-medium">{t('by_role_col_role')}</th>
                    <th scope="col" className="py-1 font-medium">{t('by_role_col_result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {roleCells(retro.by_role).map(([role, cell]) => (
                    <tr key={role}>
                      <th scope="row" className="py-1 pr-4 font-normal text-left">{tRole(ROLES.has(role) ? role : 'unassigned')}</th>
                      <td className="py-1">{t('by_role_result', { wins: cell.wins, n: cell.n })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {retro !== null && retro.status === 'acknowledged' && (
        <div className="space-y-1 border-t border-border pt-4 text-sm">
          <p className="text-foreground">
            {t('acknowledged', {
              who: retro.acknowledged_by === currentUserId ? t('who_you') : t('who_member'),
              date: retro.acknowledged_at ? format(parseISO(retro.acknowledged_at), 'PP') : '',
            })}
          </p>
          {retro.note && <p className="text-muted-foreground break-words">{t('acknowledged_note', { note: retro.note })}</p>}
        </div>
      )}

      {retro !== null && retro.status === 'completed' && <AcknowledgeForm campaignId={campaignId} conclusive={conclusive} />}

      {unavailablePlatformNames.map((platform) => (
        <p key={platform} className="text-sm text-muted-foreground">{t('metrics_unavailable', { platform })}</p>
      ))}

      <p className="text-xs text-muted-foreground">{t('measures', { platform: platformNames })}</p>
    </section>
  )
}
