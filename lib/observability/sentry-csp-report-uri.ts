export function deriveSentryCspReportUri(dsn: string | undefined): string | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\//, '')
    const publicKey = url.username
    if (!projectId || !publicKey) return null
    return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${publicKey}`
  } catch {
    return null
  }
}
