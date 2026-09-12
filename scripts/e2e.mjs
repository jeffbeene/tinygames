// End-to-end check against the real dev server.
//
// The decisive test is the round trip a user actually performs: generate a QR on
// Create, decode the rendered image with an independent decoder (jsQR), and load
// the decoded URL on Play to confirm the game runs.

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

// Vite's default dev port, so `npm run dev` then `npm run check:e2e` just works.
const BASE = process.env.BASE || 'http://localhost:5173'
const JSQR = fileURLToPath(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url))
const shot = (n) => new URL(`../.shots/${n}.png`, import.meta.url).pathname.slice(1)

let failures = 0
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!pass) failures++
}

// Headed mode matters: real Chrome lays iframes out differently from headless,
// and the canvas-sizing race below only ever reproduced with a real window.
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  channel: process.env.HEADED === '1' ? 'chrome' : undefined,
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
})

const errors = []
ctx.on('page', (p) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(`[${p.url().slice(-22)}] ${m.text()}`))
  p.on('pageerror', (e) => errors.push(`[${p.url().slice(-22)}] pageerror: ${e.message}`))
})

const page = await ctx.newPage()

// ---------------------------------------------------------------- helpers ---

const readCard = () =>
  page.evaluate(() => ({
    symbol: document.getElementById('stat-symbol')?.innerText.replace(/\n+/g, ' | '),
    min: document.getElementById('stat-min')?.textContent,
    br: document.getElementById('stat-br')?.textContent,
    urlChars: document.getElementById('stat-url')?.textContent,
    budget: document.getElementById('budget-text')?.textContent,
    pct: document.getElementById('budget-pct')?.textContent,
    tier: document.getElementById('budget-fill')?.dataset.tier,
    ticks: document.querySelectorAll('.budget-tick').length,
    state: document.getElementById('preview-state')?.textContent,
    problems: [...document.querySelectorAll('.problem')].map((n) => n.innerText),
  }))

/** Polls until a selector's text stops changing, so slow compiles are not races. */
async function settle(p, selector, { timeout = 45000, quiet = 2 } = {}) {
  const deadline = Date.now() + timeout
  let last = Symbol('init')
  let stable = 0
  while (Date.now() < deadline) {
    const now = await p.textContent(selector).catch(() => null)
    stable = now === last ? stable + 1 : 0
    last = now
    if (stable >= quiet) return last
    await p.waitForTimeout(400)
  }
  return last
}

/** Decode the on-screen QR with an independent decoder. */
async function decodeQr(p) {
  await p.addScriptTag({ path: JSQR })
  return p.evaluate(() => {
    const src = document.querySelector('.qr-canvas')
    if (!src) return { error: 'no qr canvas' }
    const img = src.getContext('2d').getImageData(0, 0, src.width, src.height)
    const r = window.jsQR(img.data, img.width, img.height)
    return r ? { text: r.data, version: r.version } : { error: 'decode failed' }
  })
}

/**
 * The canvas must exactly cover its window, and its backing store must match
 * that box times DPR. Regression guard: the frame used to parse before the
 * iframe had been laid out, so setup() ran against a 0x0 canvas and games that
 * size themselves from W/H built a tiny board in the middle of a big canvas.
 */
async function canvasFit(p) {
  const target = p.frames().find((f) => f !== p.mainFrame())
  if (!target) return { error: 'no frame' }
  return target.evaluate(() => {
    const cv = document.getElementById('g')
    if (!cv) return { kind: 'dom' }
    const dpr = Math.min(devicePixelRatio || 1, 2)
    return {
      kind: 'canvas',
      client: [cv.clientWidth, cv.clientHeight],
      inner: [innerWidth, innerHeight],
      backing: [cv.width, cv.height],
      expected: [Math.round(cv.clientWidth * dpr), Math.round(cv.clientHeight * dpr)],
    }
  })
}

const sameBox = (a, b) => a && b && a[0] === b[0] && a[1] === b[1]

/** Does the game frame paint, and does what it paints change over time? */
async function frameActivity(p, ms = 700) {
  const target = p.frames().find((f) => f !== p.mainFrame())
  if (!target) return { error: 'no frame' }

  const sample = () =>
    target.evaluate(() => {
      const cv = document.getElementById('g')
      if (!cv) {
        return {
          kind: 'dom',
          nodes: document.body.querySelectorAll('*').length,
          text: document.body.innerText.trim().slice(0, 40),
        }
      }
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      // Straight FNV-1a. An earlier variant folded the accumulator back through
      // two multiplies per step and reached a fixed point on flat backgrounds,
      // reporting "unchanged" for every game regardless of canvas size.
      let h = 2166136261
      for (let i = 0; i < d.length; i += 4 * 13) {
        h = Math.imul(h ^ d[i], 16777619)
        h = Math.imul(h ^ d[i + 1], 16777619)
        h = Math.imul(h ^ d[i + 2], 16777619)
      }
      return { kind: 'canvas', size: `${cv.width}x${cv.height}`, hash: h >>> 0, frames: window.F }
    })

  const a = await sample()
  await p.waitForTimeout(ms)
  const b = await sample()
  if (a.kind === 'dom') return { ...b, changed: null }
  return { ...b, changed: a.hash !== b.hash, advanced: b.frames > a.frames }
}

// ------------------------------------------------------------- create page ---

console.log('\n=== Create page ===')
await page.addInitScript(() => (window.confirm = () => true))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForSelector('.qr-canvas', { timeout: 30000 })
await settle(page, '#budget-pct')

const first = await readCard()
check('QR renders on load', !!first.symbol, first.symbol)
check('budget bar has tier ticks', first.ticks === 3, `${first.ticks} ticks`)
check('no problems on load', first.problems.length === 0, first.problems.join(' / '))
await page.screenshot({ path: shot('01-create') })

// ---------------------------------------------------------------- examples ---

console.log('\n=== Examples ===')
const seen = {}

for (const id of ['starter', 'snake', 'doom', 'city', 'reaction']) {
  await page.selectOption('#examples', id)
  await settle(page, '#budget-pct')
  await page.waitForTimeout(700)

  const card = await readCard()

  // These games are waiting for a player: Snake holds still until the first
  // steer. Drive them.
  const box = await page.locator('.game-frame').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.keyboard.press('ArrowDown')
  const activity = await frameActivity(page)
  await page.mouse.up()

  const decoded = await decodeQr(page)
  seen[id] = { card, decoded }

  console.log(`\n${id}: ${card.symbol}`)
  console.log(`  ${card.budget} (${card.pct})  min=${card.min}  br=${card.br}  url=${card.urlChars}`)

  check(`${id}: compiles cleanly`, card.problems.length === 0, card.problems.join(' / '))
  check(`${id}: QR decodes`, !!decoded.text, decoded.error || `${decoded.text?.length} chars`)
  check(`${id}: decoded URL is a /play/ link`, decoded.text?.startsWith(BASE + '/play/#'),
    decoded.text?.slice(0, 40))
  check(`${id}: decoded length matches reported`,
    String(decoded.text?.length) === card.urlChars?.replace(/\D/g, ''),
    `${decoded.text?.length} vs ${card.urlChars}`)

  if (id === 'reaction') {
    check(`${id}: bare-mode DOM built`, activity.kind === 'dom' && activity.nodes > 2,
      JSON.stringify(activity))
  } else {
    check(`${id}: canvas animating`, activity.changed === true && activity.advanced === true,
      JSON.stringify(activity))
    const fit = await canvasFit(page)
    check(`${id}: canvas fills its frame`, sameBox(fit.client, fit.inner),
      `client=${fit.client} inner=${fit.inner}`)
    check(`${id}: backing store matches DPR`, sameBox(fit.backing, fit.expected),
      `backing=${fit.backing} expected=${fit.expected}`)
  }
  await page.screenshot({ path: shot(`02-${id}`) })
}

// ------------------------------------------------------- shipped-code path ---

console.log('\n=== Run shipped (the exact minified code the QR carries) ===')
await page.selectOption('#examples', 'snake')
await settle(page, '#budget-pct')
await page.selectOption('#preview-source', 'shipped')
await page.waitForTimeout(1800)
await page.locator('.game-frame').click({ position: { x: 60, y: 60 } })
await page.keyboard.press('ArrowDown')
const shipped = await frameActivity(page)
check('shipped snake animates', shipped.changed === true && shipped.advanced === true,
  JSON.stringify(shipped))
await page.screenshot({ path: shot('03-shipped') })
await page.selectOption('#preview-source', 'source')
await page.waitForTimeout(1200)

// ------------------------------------------------------------- over budget ---

console.log('\n=== Over budget ===')
// One long incompressible literal: fast to minify, and Brotli cannot rescue it.
// (1200 small declarations would just get folded away by terser.)
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
const incompressible = Array.from({ length: 7000 }, () =>
  alphabet[(Math.random() * alphabet.length) | 0]).join('')

await page.click('.cm-content')
await page.keyboard.press('Control+A')
await page.keyboard.insertText(
  `let blob="${incompressible}"
draw=()=>{c.fillText(blob[F%blob.length],10,20)}`,
)

// CodeMirror virtualises long documents, so the DOM is not a reliable length
// probe; read the app's own character count instead.
await page.waitForTimeout(1200)
const srcStat = await page.textContent('#src-stat')
check('editor received the large document', /^7,0\d\d|^[7-9],\d{3}/.test(srcStat), srcStat)
await settle(page, '#budget-pct')

const over = await readCard()
console.log(`  ${over.budget} (${over.pct}) tier=${over.tier}`)
check('over-budget tier flagged', over.tier === 'over', over.tier)
check('over-budget message shown', !!(await page.$('.qr-over')))
check('copy disabled when over', await page.isDisabled('#copy-link'))
check('png disabled when over', await page.isDisabled('#save-png'))
await page.screenshot({ path: shot('04-over-budget') })

// ------------------------------------------------- syntax error resilience ---

console.log('\n=== Syntax error keeps the last good QR ===')
await page.selectOption('#examples', 'starter')
await settle(page, '#budget-pct')
const beforeBreak = await decodeQr(page)
await page.click('.cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.insertText('\nfunction broken( {')
await page.waitForTimeout(2500)
const broken = await readCard()
const afterBreak = await decodeQr(page)
check('syntax error surfaced', broken.problems.length > 0,
  broken.problems[0]?.replace(/\n/g, ' ').slice(0, 60))
check('last good QR retained', afterBreak.text === beforeBreak.text)
await page.screenshot({ path: shot('05-syntax-error') })

// ------------------------------------------- sizing handed to setup() ------

// The real regression. The canvas *box* was always correct here; what was wrong
// was the size setup() received, because the frame parsed before the iframe had
// been laid out. A game that sizes itself from W/H (Snake's grid) then built
// itself against zeroes and sat tiny in the middle until something resized.
// Authored through the app's own pipeline so the whole chain is exercised.
console.log()
console.log('=== Sizing handed to setup() ===')
const frameEval = (p, fn) => p.frames().find((f) => f !== p.mainFrame()).evaluate(fn)

await page.click('.cm-content')
await page.keyboard.press('Control+A')
await page.keyboard.insertText(
  `setup = () => { window.__setup = [W, H] }
draw = () => { window.__draw = [W, H]; c.fillStyle = '#223'; c.fillRect(0, 0, W, H) }`,
)
await settle(page, '#budget-pct')
await page.waitForTimeout(900)

const createSizing = await frameEval(page, () => ({
  setup: window.__setup, draw: window.__draw, inner: [innerWidth, innerHeight],
}))
check('create: setup() saw the real canvas size',
  sameBox(createSizing.setup, createSizing.inner),
  `setup=${createSizing.setup} inner=${createSizing.inner}`)

const probeUrl = (await decodeQr(page)).text
const probe = await ctx.newPage()
await probe.goto(probeUrl, { waitUntil: 'networkidle' })
await probe.waitForTimeout(2200)
const playSizing = await frameEval(probe, () => ({
  setup: window.__setup, draw: window.__draw, inner: [innerWidth, innerHeight],
}))
check('play: setup() saw the real viewport',
  sameBox(playSizing.setup, playSizing.inner),
  `setup=${playSizing.setup} inner=${playSizing.inner}`)
check('play: draw() agrees with setup()', sameBox(playSizing.draw, playSizing.setup),
  `draw=${playSizing.draw} setup=${playSizing.setup}`)
await probe.close()

// Bare mode has no harness to defer anything, so its code runs during parse and
// reads innerWidth directly. It depends entirely on the frame not being attached
// before the iframe has a box.
await page.selectOption('#runtime', '1')
await page.click('.cm-content')
await page.keyboard.press('Control+A')
await page.keyboard.insertText('window.__atParse = [innerWidth, innerHeight]')
await settle(page, '#budget-pct')
await page.waitForTimeout(900)
const bareSizing = await frameEval(page, () => ({
  atParse: window.__atParse, now: [innerWidth, innerHeight],
}))
check('bare mode: innerWidth is real during parse',
  sameBox(bareSizing.atParse, bareSizing.now),
  `atParse=${bareSizing.atParse} now=${bareSizing.now}`)
await page.selectOption('#runtime', '0')
await page.waitForTimeout(600)

// ------------------------------------------------- harvest the real link ---

await page.selectOption('#examples', 'snake')
await settle(page, '#budget-pct')
const shareUrl = (await decodeQr(page)).text
console.log(`\nharvested from the QR image: ${shareUrl.length} chars`)
await page.screenshot({ path: shot('06-create-final') })

// --------------------------------------------------------------- play page ---

console.log('\n=== Play page ===')
const play = await ctx.newPage()
await play.goto(shareUrl, { waitUntil: 'networkidle' })
await play.waitForTimeout(3000)

const playState = await play.evaluate(() => ({
  boot: document.getElementById('boot').hidden,
  fail: document.getElementById('fail').hidden,
  menu: !document.getElementById('menu-open').hidden,
  frame: !!document.querySelector('.game-frame'),
  crash: document.querySelector('.crash')?.textContent ?? null,
  sub: document.getElementById('sheet-sub')?.textContent,
}))
check('boot overlay cleared', playState.boot === true)
check('no failure screen', playState.fail === true)
check('game frame mounted', playState.frame === true)
check('no crash banner', playState.crash === null, playState.crash ?? '')
check('corner button visible', playState.menu === true)
console.log('  sheet says:', playState.sub)

// Snake waits for the first steer, so start it before measuring.
await play.locator('.game-frame').click({ position: { x: 80, y: 80 } })
await play.keyboard.press('ArrowDown')
const playActivity = await frameActivity(play, 800)
check('game animating on Play', playActivity.changed === true && playActivity.advanced === true,
  JSON.stringify(playActivity))
const playFit = await canvasFit(play)
check('play: canvas fills the viewport', sameBox(playFit.client, playFit.inner),
  `client=${playFit.client} inner=${playFit.inner}`)
check('play: backing store matches DPR', sameBox(playFit.backing, playFit.expected),
  `backing=${playFit.backing} expected=${playFit.expected}`)
await play.screenshot({ path: shot('07-play') })

// A resize must be picked up and re-fit, not just the initial layout.
await play.setViewportSize({ width: 900, height: 1200 })
await play.waitForTimeout(900)
const resizedFit = await canvasFit(play)
check('play: refits after a resize', sameBox(resizedFit.client, resizedFit.inner) &&
  sameBox(resizedFit.backing, resizedFit.expected),
  `client=${resizedFit.client} inner=${resizedFit.inner}`)
await play.setViewportSize({ width: 1440, height: 900 })
await play.waitForTimeout(900)

await play.keyboard.press('ArrowUp')
await play.waitForTimeout(500)
await play.keyboard.press('ArrowRight')
await play.waitForTimeout(1400)
check('still running after input', (await frameActivity(play, 500)).advanced === true)
await play.screenshot({ path: shot('08-play-input') })

await play.click('#menu-open')
await play.waitForTimeout(400)
check('sheet opens', await play.isVisible('.sheet-card'))
const remixHref = await play.getAttribute('#act-remix', 'href')
check('remix link carries payload', remixHref?.startsWith('/#') && remixHref.length > 100)
await play.screenshot({ path: shot('09-play-sheet') })

// ------------------------------------------------------------ error paths ---

console.log('\n=== Error paths ===')
const cases = [
  ['#QQQQQQQQQQQQ', 'wrong format version'],
  ['#not~valid~base42', 'illegal characters'],
  ['', 'no payload at all'],
]
for (const [frag, label] of cases) {
  const p = await ctx.newPage()
  await p.goto(BASE + '/play/' + frag, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const st = await p.evaluate(() => ({
    visible: !document.getElementById('fail').hidden,
    title: document.getElementById('fail-title').textContent,
    msg: document.getElementById('fail-msg').textContent,
  }))
  check(`${label}: explained, not blank`, st.visible && !!st.title,
    `${st.title} / ${st.msg}`.slice(0, 88))
  await p.close()
}
const shotEmpty = await ctx.newPage()
await shotEmpty.goto(BASE + '/play/', { waitUntil: 'networkidle' })
await shotEmpty.waitForTimeout(900)
await shotEmpty.screenshot({ path: shot('10-empty') })

// ------------------------------------------------------------ remix cycle ---

console.log('\n=== Remix round trip ===')
const remix = await ctx.newPage()
await remix.goto(BASE + '/#' + shareUrl.split('#')[1], { waitUntil: 'networkidle' })
await remix.waitForSelector('.qr-canvas', { timeout: 30000 })
await settle(remix, '#budget-pct')

const remixed = await remix.evaluate(() => ({
  firstLine: document.querySelector('.cm-content')?.innerText.split('\n')[0],
  runtime: document.getElementById('runtime').value,
  hash: location.hash,
  budget: document.getElementById('budget-text')?.textContent,
  notice: document.querySelector('.problem-info .problem-msg')?.textContent,
}))
console.log('  line 1:', JSON.stringify(remixed.firstLine?.slice(0, 78)) + '…')
// The QR carries only the minified build, so this is what remix must return.
check('remix restored runnable code',
  remixed.firstLine?.includes('draw=') && remixed.firstLine?.includes('snd('),
  remixed.firstLine?.slice(0, 40))
check('remix explains the minified source', (remixed.notice ?? '').includes('minified'),
  remixed.notice?.slice(0, 70))
check('remix cleared the hash', remixed.hash === '', remixed.hash)
check('remix kept the runtime mode', remixed.runtime === '0', remixed.runtime)
check('remix reproduces the same size', remixed.budget === seen.snake.card.budget,
  `${remixed.budget} vs ${seen.snake.card.budget}`)
await remix.screenshot({ path: shot('11-remix') })

// ------------------------------------------------------------------- done ---

console.log('\n=== Console errors ===')
// The syntax-error test deliberately feeds broken code to a game frame, so its
// parse errors are expected; anything else is not.
const real = errors.filter((e) => !/favicon|ERR_|Unexpected (end of input|token)|Invalid or unexpected token/.test(e))
console.log(real.length ? real.slice(0, 12).join('\n') : '  none (broken-code parse errors excluded)')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
await browser.close()
process.exit(failures ? 1 : 0)
