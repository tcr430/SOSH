import type { BusinessRow, PostRow } from '@/lib/db/types'
import { enqueueEmail } from '@/lib/email/enqueue'

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
}

function humanPlatformName(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

export async function enqueueFirstPostPublished(opts: {
  business: BusinessRow
  post: PostRow
  postUrl: string | null
}): Promise<void> {
  const { business, post, postUrl } = opts

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { data: authData, error } = await client.auth.admin.getUserById(business.owner_id)
  if (error || !authData.user?.email) return

  const recipient = authData.user.email.toLowerCase()

  await enqueueEmail({
    business_id: business.id,
    kind: 'first-post-published',
    recipient,
    locale: business.language,
    props: {
      businessName: business.name,
      platform: humanPlatformName(post.platform),
      postUrl: postUrl ?? '',
    },
    dedupe_token: null,
  })
}
