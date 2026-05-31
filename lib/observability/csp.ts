export function buildCsp(
  nonce: string,
  reportUri: string | null,
  enforce: boolean,
  postizHost?: string,
): { headerName: string; headerValue: string } {
  const connectSrcExtras = postizHost ? ` ${postizHost}` : ''

  const directives: string[] = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://va.vercel-scripts.com`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com https://vitals.vercel-insights.com${connectSrcExtras}`,
    `frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com`,
    `frame-ancestors 'none'`,
    `form-action 'self' https://checkout.stripe.com`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ]

  if (reportUri) {
    directives.push(`report-uri ${reportUri}`)
  }

  return {
    headerName: enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    headerValue: directives.join('; '),
  }
}
