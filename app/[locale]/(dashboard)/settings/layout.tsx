import { SettingsNav } from '@/components/layout/SettingsNav'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export default async function SettingsLayout({ params, children }: Props) {
  const { locale } = await params

  return (
    <div className="flex gap-10 max-w-4xl">
      <SettingsNav locale={locale} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
