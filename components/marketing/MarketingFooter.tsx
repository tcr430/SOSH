import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import LocaleSwitcher from '@/components/marketing/LocaleSwitcher'

export default async function MarketingFooter() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.footer')

  const columns = [
    {
      heading: t('col_product'),
      links: [
        { label: t('link_features'), href: `/${locale}#features` },
        { label: t('link_pricing'), href: `/${locale}/pricing` },
      ],
    },
    {
      heading: t('col_legal'),
      links: [
        { label: t('link_terms'), href: `/${locale}/terms` },
        { label: t('link_subprocessors'), href: `/${locale}/subprocessors` },
        { label: t('link_privacy'), href: `/${locale}/privacy` },
      ],
    },
    {
      heading: t('col_company'),
      links: [
        { label: t('link_signin'), href: `/${locale}/login` },
        { label: t('link_signup'), href: `/${locale}/signup` },
      ],
    },
  ]

  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-2">
            <p className="text-lg font-bold tracking-tight">{t('tagline')}</p>
          </div>
          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {column.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <LocaleSwitcher />
          <p className="text-sm text-muted-foreground">{t('copyright')}</p>
        </div>
      </div>
    </footer>
  )
}
