// ADR 0031 §5.5, REPORT-PDF-ISOLATED (#30) — render ONE prepared document to a PDF in a sealed Chromium. The caller has already
// authenticated, resolved the active business, loaded the report by (business, id) and checked the plan: this module is
// reached only after all of that, and launches nothing before it is called.
//
// Hardening, all of it, in this order:
//   1. a FRESH browser context per request, closed in `finally` (no cookie, cache or storage is shared between renders);
//   2. JavaScript DISABLED before any content;
//   3. request interception ON, and EVERY request aborted: the document is set from a string, so a legitimate render makes
//      none, and anything that tries (an image, a stylesheet link, a font, a redirect) is blocked and counted;
//   4. `setContent` only: no `goto`, no `file://`, no cookies, no auth headers, nothing else is ever handed to the page;
//   5. a HARD timeout over the whole render, launch included, that also kills the browser;
//   6. CONCURRENCY 1 per instance, with a bounded queue (a full queue is refused, not left to pile up).
// The CSP meta in the document (lib/reports/pdf-html.ts) is a further, independent layer. The buffer is returned and never stored.

export interface PdfRequest {
  url(): string
  abort(errorCode?: string): Promise<void>
}
export interface PdfPage {
  setJavaScriptEnabled(enabled: boolean): Promise<void>
  setRequestInterception(enabled: boolean): Promise<void>
  on(event: 'request', handler: (request: PdfRequest) => void): unknown
  setContent(html: string, options: { waitUntil: 'load'; timeout: number }): Promise<void>
  pdf(options: { format: 'A4'; printBackground: boolean; preferCSSPageSize: boolean; timeout: number }): Promise<Uint8Array>
}
export interface PdfContext {
  newPage(): Promise<PdfPage>
  close(): Promise<void>
}
export interface PdfBrowser {
  createBrowserContext(): Promise<PdfContext>
  close(): Promise<void>
}
export type PdfLauncher = () => Promise<PdfBrowser>

export const PDF_TIMEOUT_MS = 25_000
/** One render at a time per instance; at most this many more may wait. A further request is refused (PdfBusyError). */
export const PDF_MAX_WAITING = 2

export class PdfTimeoutError extends Error {
  constructor() {
    super('report pdf: render timed out')
    this.name = 'PdfTimeoutError'
  }
}
export class PdfBusyError extends Error {
  constructor() {
    super('report pdf: renderer busy')
    this.name = 'PdfBusyError'
  }
}

export interface RenderPdfDeps {
  launch: PdfLauncher
  timeoutMs?: number
  /** Called with the URL of every request the page tried to make (all of them were aborted). A test hook: nothing logs it. */
  onRequestBlocked?: (url: string) => void
}

export interface RenderedPdf {
  pdf: Buffer
  /** How many requests the page attempted. Anything other than 0 means the document tried to reach out. */
  blockedRequests: number
}

let tail: Promise<unknown> = Promise.resolve()
let waiting = 0

async function renderOnce(html: string, deps: RenderPdfDeps, timeoutMs: number): Promise<RenderedPdf> {
  let browser: PdfBrowser | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let blocked = 0
  // Set once this render has ended (finished, failed or timed out). A launch that resolves AFTER that must not carry on: its
  // browser would be an orphan process running beside the next render (security review, finding 1).
  let settled = false

  const work = (async (): Promise<RenderedPdf> => {
    const launched = await deps.launch()
    if (settled) {
      await launched.close().catch(() => undefined)
      throw new PdfTimeoutError()
    }
    browser = launched
    const context = await browser.createBrowserContext()
    try {
      const page = await context.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        blocked += 1
        deps.onRequestBlocked?.(request.url())
        void request.abort('blockedbyclient').catch(() => undefined)
      })
      await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs })
      const bytes = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: timeoutMs })
      return { pdf: Buffer.from(bytes), blockedRequests: blocked }
    } finally {
      await context.close().catch(() => undefined)
    }
  })()

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Killing the browser is what stops the work: a hung launch, navigation or print would otherwise hold the slot.
      const hung = browser as PdfBrowser | null
      void hung?.close().catch(() => undefined)
      reject(new PdfTimeoutError())
    }, timeoutMs)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    settled = true
    clearTimeout(timer)
    // The work promise may still be settling after a timeout: swallow its rejection, never leave it unhandled.
    work.catch(() => undefined)
    const opened = browser as PdfBrowser | null
    await opened?.close().catch(() => undefined)
  }
}

/** True when a new render would be refused. The route asks BEFORE building the document, so a saturated instance spends nothing. */
export function pdfQueueFull(): boolean {
  return waiting > PDF_MAX_WAITING
}

export async function renderPdf(html: string, deps: RenderPdfDeps): Promise<RenderedPdf> {
  // `waiting` counts the render in progress AND those queued behind it: one runs, at most PDF_MAX_WAITING more may wait.
  if (waiting > PDF_MAX_WAITING) throw new PdfBusyError()
  const timeoutMs = deps.timeoutMs ?? PDF_TIMEOUT_MS
  waiting += 1
  const turn = tail.then(
    () => renderOnce(html, deps, timeoutMs),
    () => renderOnce(html, deps, timeoutMs),
  )
  // The next caller waits for this one to SETTLE, whatever the outcome.
  tail = turn.catch(() => undefined).finally(() => {
    waiting -= 1
  })
  return turn
}
