import { describe, it, expect } from 'vitest'
import { PDF_MAX_WAITING, PdfBusyError, PdfTimeoutError, renderPdf, type PdfBrowser, type PdfPage, type PdfRequest } from '../pdf'

// ADR 0031 §5.5, REPORT-PDF-ISOLATED (#30), Tier 2. A fake browser records every call in order, so the hardening is asserted as
// a SEQUENCE, not as a set of calls that happened. (The real-Chromium proof is recorded in ADR 0031 V.14: it needs a browser
// binary, so it is a manual run and never counted as COVERED here.)

interface Fake {
  log: string[]
  launch: () => Promise<PdfBrowser>
  fire: (urls: string[]) => Promise<string[]>
  aborted: string[]
  setContentArg: () => string | undefined
}

function fakeBrowser(over: { setContent?: () => Promise<void>; pdf?: () => Promise<Uint8Array>; launchDelay?: Promise<void> } = {}): Fake {
  const log: string[] = []
  const aborted: string[] = []
  let handler: ((r: PdfRequest) => void) | undefined
  let content: string | undefined
  const page: PdfPage = {
    setJavaScriptEnabled: async (v) => void log.push('js:' + v),
    setRequestInterception: async (v) => void log.push('intercept:' + v),
    on: (_event, h) => {
      log.push('on:request')
      handler = h
    },
    setContent: async (html) => {
      log.push('setContent')
      content = html
      await over.setContent?.()
    },
    pdf: async () => {
      log.push('pdf')
      return (await over.pdf?.()) ?? new Uint8Array([0x25, 0x50, 0x44, 0x46])
    },
  }
  const browser: PdfBrowser = {
    createBrowserContext: async () => {
      log.push('context:new')
      return {
        newPage: async () => (log.push('page:new'), page),
        close: async () => void log.push('context:close'),
      }
    },
    close: async () => void log.push('browser:close'),
  }
  return {
    log,
    aborted,
    launch: async () => {
      log.push('launch')
      await over.launchDelay
      return browser
    },
    // Simulate the page trying to reach out; the real handler must abort each one.
    fire: async (urls) => {
      for (const url of urls) handler?.({ url: () => url, abort: async (code) => void aborted.push(url + '|' + code) })
      await Promise.resolve()
      return aborted
    },
    setContentArg: () => content,
  }
}

const HTML = '<!doctype html><html><body>report</body></html>'

describe('the hardening is a sequence', () => {
  it('launch, a FRESH context, a page, JavaScript off, interception on, the listener, setContent, pdf, then context and browser closed', async () => {
    const f = fakeBrowser()
    const out = await renderPdf(HTML, { launch: f.launch })
    expect(f.log).toEqual(['launch', 'context:new', 'page:new', 'js:false', 'intercept:true', 'on:request', 'setContent', 'pdf', 'context:close', 'browser:close'])
    expect(Buffer.isBuffer(out.pdf)).toBe(true)
    expect(out.pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(out.blockedRequests).toBe(0)
  })

  it('JavaScript is disabled and interception is on BEFORE any content is set', async () => {
    const f = fakeBrowser()
    await renderPdf(HTML, { launch: f.launch })
    expect(f.log.indexOf('js:false')).toBeLessThan(f.log.indexOf('setContent'))
    expect(f.log.indexOf('intercept:true')).toBeLessThan(f.log.indexOf('setContent'))
    expect(f.log.indexOf('on:request')).toBeLessThan(f.log.indexOf('setContent'))
  })

  it('hands the page the document string and nothing else: setContent is the only way content enters', async () => {
    const f = fakeBrowser()
    await renderPdf(HTML, { launch: f.launch })
    expect(f.setContentArg()).toBe(HTML)
    // The page type has no goto, no cookie and no header method: the fake could not have been called with one.
    expect(f.log.filter((l) => /goto|cookie|header|file:/i.test(l))).toEqual([])
  })
})

describe('every request is aborted', () => {
  it('an image, a stylesheet, a script, a font and a redirect target are all aborted as blockedbyclient, and counted', async () => {
    const f = fakeBrowser({
      setContent: async () => {
        await f.fire(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:9/css', 'https://evil.example/s.js', 'https://evil.example/f.woff2', 'file:///etc/passwd', 'data:image/png;base64,AAAA'])
      },
    })
    const seen: string[] = []
    const out = await renderPdf(HTML, { launch: f.launch, onRequestBlocked: (u) => seen.push(u) })
    expect(f.aborted).toHaveLength(6)
    for (const a of f.aborted) expect(a.endsWith('|blockedbyclient')).toBe(true)
    expect(seen).toHaveLength(6)
    expect(out.blockedRequests).toBe(6)
  })

  it('nothing is let through: there is no allow-list, not even for the document or a data: URL', async () => {
    const f = fakeBrowser({ setContent: async () => void (await f.fire(['about:blank', 'data:text/html,x', 'http://localhost/'])) })
    const out = await renderPdf(HTML, { launch: f.launch })
    expect(out.blockedRequests).toBe(3)
    expect(f.aborted).toHaveLength(3)
  })
})

describe('everything is closed, whatever happens', () => {
  it('a failing setContent still closes the context and the browser, and the error propagates', async () => {
    const f = fakeBrowser({ setContent: async () => { throw new Error('boom') } })
    await expect(renderPdf(HTML, { launch: f.launch })).rejects.toThrow('boom')
    expect(f.log.slice(-2)).toEqual(['context:close', 'browser:close'])
  })

  it('a failing pdf still closes both', async () => {
    const f = fakeBrowser({ pdf: async () => { throw new Error('print failed') } })
    await expect(renderPdf(HTML, { launch: f.launch })).rejects.toThrow('print failed')
    expect(f.log.slice(-2)).toEqual(['context:close', 'browser:close'])
  })

  it('a launch that fails opens nothing and leaves nothing to close', async () => {
    await expect(renderPdf(HTML, { launch: async () => { throw new Error('no chrome') } })).rejects.toThrow('no chrome')
  })
})

describe('the hard timeout', () => {
  it('a render that never finishes ends in PdfTimeoutError and the browser is killed', async () => {
    const f = fakeBrowser({ pdf: () => new Promise<Uint8Array>(() => undefined) })
    await expect(renderPdf(HTML, { launch: f.launch, timeoutMs: 30 })).rejects.toBeInstanceOf(PdfTimeoutError)
    expect(f.log).toContain('browser:close')
  })

  it('a launch that never returns also times out (the deadline covers the launch, not just the print)', async () => {
    const never = new Promise<void>(() => undefined)
    const f = fakeBrowser({ launchDelay: never })
    await expect(renderPdf(HTML, { launch: f.launch, timeoutMs: 30 })).rejects.toBeInstanceOf(PdfTimeoutError)
  })

  it('a launch that resolves AFTER the deadline is closed at once and never used (no orphan Chromium beside the next render)', async () => {
    let release!: () => void
    const late = new Promise<void>((r) => (release = r))
    const f = fakeBrowser({ launchDelay: late })
    await expect(renderPdf(HTML, { launch: f.launch, timeoutMs: 20 })).rejects.toBeInstanceOf(PdfTimeoutError)
    release()
    await new Promise((r) => setTimeout(r, 30))
    expect(f.log).toContain('browser:close')
    expect(f.log).not.toContain('context:new')
    expect(f.log).not.toContain('setContent')
  })

  it('a timed-out render does not wedge the next one', async () => {
    const hung = fakeBrowser({ pdf: () => new Promise<Uint8Array>(() => undefined) })
    await expect(renderPdf(HTML, { launch: hung.launch, timeoutMs: 20 })).rejects.toBeInstanceOf(PdfTimeoutError)
    const ok = fakeBrowser()
    await expect(renderPdf(HTML, { launch: ok.launch })).resolves.toMatchObject({ blockedRequests: 0 })
  })
})

describe('concurrency 1 per instance, bounded', () => {
  it('two simultaneous renders never overlap: the second launches only after the first has closed', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const make = (name: string): (() => Promise<PdfBrowser>) => async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push('launch:' + name)
      const f = fakeBrowser({ pdf: async () => (await new Promise((r) => setTimeout(r, 15)), new Uint8Array([1])) })
      const b = await f.launch()
      return { ...b, close: async () => { active -= 1; order.push('close:' + name); await b.close() } }
    }
    await Promise.all([renderPdf(HTML, { launch: make('a') }), renderPdf(HTML, { launch: make('b') })])
    expect(maxActive).toBe(1)
    expect(order).toEqual(['launch:a', 'close:a', 'launch:b', 'close:b'])
  })

  it(`one running plus at most ${PDF_MAX_WAITING} waiting: the next request is refused with PdfBusyError, not queued`, async () => {
    const gate = new Promise<void>((r) => setTimeout(r, 40))
    const make = () => fakeBrowser({ launchDelay: gate }).launch
    const runs = [0, 1, 2].map(() => renderPdf(HTML, { launch: make() }))
    await expect(renderPdf(HTML, { launch: make() })).rejects.toBeInstanceOf(PdfBusyError)
    await Promise.all(runs)
    // Once they have drained, the slot is free again.
    await expect(renderPdf(HTML, { launch: fakeBrowser().launch })).resolves.toBeTruthy()
  })

  it('a rejected render releases its place in the queue', async () => {
    const bad = renderPdf(HTML, { launch: async () => { throw new Error('x') } })
    const good = renderPdf(HTML, { launch: fakeBrowser().launch })
    await expect(bad).rejects.toThrow('x')
    await expect(good).resolves.toMatchObject({ blockedRequests: 0 })
  })
})

describe('the buffer is returned, never stored', () => {
  it('the module imports no filesystem, storage or network API', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../pdf.ts', import.meta.url), 'utf8'))
    const code = src.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/from ['"]node:fs|from ['"]fs|writeFile|storage|\.upload\(|fetch\(/)
  })
})
