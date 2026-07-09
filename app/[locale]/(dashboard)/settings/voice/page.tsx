import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listVariations } from '@/lib/db/voice'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { VoiceEditor } from '@/components/voice/VoiceEditor'
import { VariationManager } from '@/components/voice/VariationManager'
import { RefineFromPostsButton } from './RefineFromPostsButton'
import {
  saveBaseVoiceAction,
  addVariationAction,
  renameVariationAction,
  deleteVariationAction,
  updateVariationAxesAction,
} from './actions'

export default async function VoiceSettingsPage() {
  const t = await getTranslations('settings.voice')
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()

  if (!user) return null

  const business = await getBusinessForUser(client, user.id)
  if (!business) return null

  const [brandVoice, variations, accounts] = await Promise.all([
    getBrandVoice(client, business.id),
    listVariations(client, business.id),
    listActiveSocialAccounts(client, business.id),
  ])

  const baseAxes = brandVoice?.voice_axes ?? {
    formal_casual: 50, expert_peer: 50, serious_playful: 50,
    reserved_warm: 50, calm_energetic: 50, rational_emotional: 50,
    exclusive_inclusive: 50,
  }

  return (
    <div className="max-w-3xl space-y-12">
      {/* ── Base voice editor ── */}
      <section className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <VoiceEditor
          initialAxes={baseAxes}
          initialKeywords={brandVoice?.keywords ?? []}
          initialAvoidWords={brandVoice?.avoid_words ?? []}
          onSave={saveBaseVoiceAction}
        />
      </section>

      {/* ── Refine from posts ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('refine_title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('refine_subtitle')}</p>
        </div>

        <RefineFromPostsButton hasConnectedAccounts={accounts.length > 0} />
      </section>

      {/* ── Variations ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('variations_title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('variations_subtitle')}</p>
        </div>

        <VariationManager
          baseAxes={baseAxes}
          variations={variations}
          addAction={addVariationAction}
          renameAction={renameVariationAction}
          deleteAction={deleteVariationAction}
          updateAxesAction={updateVariationAxesAction}
        />
      </section>
    </div>
  )
}
