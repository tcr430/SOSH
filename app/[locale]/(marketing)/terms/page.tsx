import type { Metadata } from 'next'
import LegalPage from '@/components/marketing/LegalPage'
import { marketingMetadata } from '@/lib/marketing/metadata'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return marketingMetadata(locale, 'terms')
}

export default function TermsPage() {
  return <LegalPage slug="terms" />
}
