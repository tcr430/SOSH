import { Step1Form } from './Step1Form'

export default async function Step1Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <Step1Form locale={locale} />
}
