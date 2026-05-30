import { Step2Form } from './Step2Form'

export default async function Step2Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <Step2Form locale={locale} />
}
