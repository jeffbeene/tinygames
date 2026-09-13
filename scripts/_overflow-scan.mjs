// Throwaway: sweep every reachable screen on emulated phones/tablets and report
// anything that overflows the viewport or gets clipped by its container.
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173'
const OUT = process.argv[2]

const DEVICES = [
  ['320 small', { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['iPhone SE', devices['iPhone SE']],
  ['iPhone 13', devices['iPhone 13']],
  ['Pixel 7', devices['Pixel 7']],
  ['iPhone 13 land', devices['iPhone 13 landscape']],
  ['Pixel 7 land', devices['Pixel 7 landscape']],
  ['iPad Mini', devices['iPad Mini']],
]

// Runs in the page. Returns a list of human-readable problems.
function detect(squeezeChecks) {
  const vw = innerWidth, vh = innerHeight
  const out = []
  const doc = document.documentElement
  if (doc.scrollWidth > vw + 1) out.push(`document wider than viewport: ${doc.scrollWidth} > ${vw}`)
  if (doc.scrollHeight > vh + 1) out.push(`document taller than viewport: ${doc.scrollHeight} > ${vh}`)

  const name = (e) => {
    let s = e.tagName.toLowerCase()
    if (e.id) return s + '#' + e.id
    if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\s+/).join('.')
    return s
  }
  const path = (e) => {
    const parts = []
    for (let n = e; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      parts.unshift(name(n))
      if (n.id) break
    }
    return parts.join(' > ')
  }
  const visible = (e) => {
    const r = e.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const cs = getComputedStyle(e)
    return cs.visibility !== 'hidden' && cs.display !== 'contents'
  }
  // Inside something that scrolls on this axis, or inside CodeMirror / a select?
  const scrollsWithin = (e, axis) => {
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const ov = axis === 'x' ? cs.overflowX : cs.overflowY
      if (ov === 'auto' || ov === 'scroll') return true
    }
    return false
  }
  const skip = (e) => e.closest('.cm-editor, select, svg, .game-frame')

  const all = [...document.body.querySelectorAll('*')].filter((e) => !skip(e) && visible(e))

  // 1. Off-screen and unreachable. Report only the outermost offender per edge.
  const offenders = new Map()
  for (const e of all) {
    const r = e.getBoundingClientRect()
    const edges = []
    if (r.right > vw + 1 && !scrollsWithin(e, 'x')) edges.push(`right +${Math.round(r.right - vw)}`)
    if (r.left < -1 && !scrollsWithin(e, 'x')) edges.push(`left ${Math.round(r.left)}`)
    if (r.bottom > vh + 1 && !scrollsWithin(e, 'y')) edges.push(`bottom +${Math.round(r.bottom - vh)}`)
    if (r.top < -1 && !scrollsWithin(e, 'y')) edges.push(`top ${Math.round(r.top)}`)
    if (!edges.length) continue
    // Clipped away entirely by an overflow:hidden ancestor? Then it's category 2.
    let clipped = false
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflow !== 'visible') { clipped = true; break }
    }
    if (clipped) continue
    let parentOffends = false
    for (let n = e.parentElement; n; n = n.parentElement) if (offenders.has(n)) { parentOffends = true; break }
    if (!parentOffends) offenders.set(e, `off-screen ${edges.join(', ')}: ${path(e)}`)
  }
  out.push(...offenders.values())

  // 2. Content clipped by a non-scrolling container.
  for (const e of all) {
    const cs = getComputedStyle(e)
    if (['INPUT', 'TEXTAREA', 'CANVAS', 'IFRAME'].includes(e.tagName)) continue
    const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
    const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
    const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight
    if (clipX && dx > 1) {
      if (cs.textOverflow === 'ellipsis') out.push(`truncated text "${e.textContent.trim().slice(0, 40)}" (${dx}px hidden): ${path(e)}`)
      else out.push(`clipped horizontally by ${dx}px: ${path(e)}`)
    }
    if (clipY && dy > 1 && e !== document.body) out.push(`clipped vertically by ${dy}px: ${path(e)}`)
  }

  // 3. Children spilling out of a non-clipping parent (flex/grid squeeze).
  for (const e of all) {
    const p = e.parentElement
    if (!p || p === document.body || skip(p)) continue
    const pcs = getComputedStyle(p), cs = getComputedStyle(e)
    if (pcs.overflow !== 'visible' || cs.position === 'absolute' || cs.position === 'fixed') continue
    if (pcs.display.includes('inline') || cs.display.includes('inline') && !cs.display.includes('flex') && !cs.display.includes('block')) continue
    const r = e.getBoundingClientRect(), pr = p.getBoundingClientRect()
    if (r.right > pr.right + 2) out.push(`spills ${Math.round(r.right - pr.right)}px out of parent on the right: ${path(e)}`)
    if (r.bottom > pr.bottom + 2 && pcs.height !== 'auto') out.push(`spills ${Math.round(r.bottom - pr.bottom)}px out of parent at the bottom: ${path(e)}`)
  }

  // 4. Things that must keep a usable size.
  for (const [sel, minW, minH] of squeezeChecks) {
    const e = document.querySelector(sel)
    if (!e || !visible(e)) continue
    const r = e.getBoundingClientRect()
    if (r.width < minW || r.height < minH) out.push(`squeezed: ${sel} is ${Math.round(r.width)}x${Math.round(r.height)} (want >= ${minW}x${minH})`)
  }
  return [...new Set(out)]
}

const results = []
const record = async (page, device, screen, squeeze = []) => {
  await page.waitForTimeout(250)
  const problems = await page.evaluate(detect, squeeze)
  results.push({ device, screen, problems })
  if (problems.length && OUT) {
    await page.screenshot({ path: `${OUT}/scan-${device.replace(/\W+/g, '_')}-${screen.replace(/\W+/g, '_')}.png` })
  }
}

const settle = async (page) => {
  let last = null
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250)
    const now = await page.textContent('#budget-pct')
    if (now && now === last) return
    last = now
  }
}

const typeSource = async (page, text) => {
  await page.click('.cm-content')
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(text)
  await page.waitForTimeout(1500)
  await settle(page)
}

const linkFor = async (page) => {
  await page.evaluate(() => document.getElementById('copy-link').click())
  await page.waitForTimeout(200)
  return page.evaluate(() => navigator.clipboard.readText())
}

const browser = await chromium.launch()
const CREATE_SQUEEZE = [['.stage', 120, 80], ['.editor-host', 120, 60], ['#qr-holder', 60, 60]]

// Build share links once, on desktop, so every device plays the same payloads.
const setupCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const sp = await setupCtx.newPage()
await sp.goto(BASE + '/', { waitUntil: 'networkidle' })
await sp.selectOption('#examples', 'snake')
await settle(sp)
const snakeLink = await linkFor(sp)
await typeSource(sp, `setup=()=>{}\ndraw=()=>{throw new Error("this game deliberately crashes with a fairly long error message to see how the banner copes on a small screen")}`)
const crashLink = await linkFor(sp)
await setupCtx.close()

for (const [device, opts] of DEVICES) {
  const ctx = await browser.newContext({ ...opts, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())

  // ---- Create
  await page.goto('about:blank'); await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await settle(page)
  await record(page, device, 'create: default', CREATE_SQUEEZE)

  if (await page.isVisible('#settings-toggle')) {
    await page.click('#settings-toggle')
    await record(page, device, 'create: settings panel open')
    await page.click('#settings-toggle')
  }

  await page.evaluate(() => document.getElementById('help-open').click())
  await record(page, device, 'create: help modal')
  await page.evaluate(() => document.getElementById('help-close').click())

  await page.evaluate(() => document.getElementById('qr-expand').click())
  await record(page, device, 'create: QR lightbox')
  await page.evaluate(() => document.getElementById('lightbox-close').click())

  await page.selectOption('#examples', 'starter').catch(async () => {
    await page.click('#settings-toggle'); await page.selectOption('#examples', 'starter'); await page.click('#settings-toggle')
  })
  await settle(page)
  await page.click('.cm-content')
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nfunction broken( {')
  await page.waitForTimeout(2500)
  await record(page, device, 'create: syntax error problems panel', CREATE_SQUEEZE)

  await typeSource(page, `draw=()=>{throw new Error("a deliberately long runtime error message that keeps going so we can see whether the problems panel wraps it or pushes things sideways")}`)
  await page.waitForTimeout(1500)
  await record(page, device, 'create: runtime error', CREATE_SQUEEZE)

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const blob = Array.from({ length: 7000 }, () => alphabet[(Math.random() * alphabet.length) | 0]).join('')
  await typeSource(page, `let blob="${blob}"\ndraw=()=>{c.fillText(blob[F%blob.length],10,20)}`)
  await record(page, device, 'create: over budget', CREATE_SQUEEZE)

  await page.goto('about:blank'); await page.goto(BASE + '/#' + snakeLink.split('#')[1], { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await settle(page)
  await record(page, device, 'create: remixed from link (notice)', CREATE_SQUEEZE)

  // ---- Play
  await page.goto('about:blank'); await page.goto(snakeLink, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('gate-go').disabled, null, { timeout: 20000 })
  await record(page, device, 'play: gate')
  await page.click('#gate-go')
  await page.waitForTimeout(1500)
  await record(page, device, 'play: running')
  await page.evaluate(() => document.getElementById('menu-open').click())
  await record(page, device, 'play: options sheet')

  await page.goto('about:blank'); await page.goto(crashLink, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('gate-go').disabled, null, { timeout: 20000 })
  await page.click('#gate-go')
  await page.waitForTimeout(2000)
  await record(page, device, 'play: crash banner')

  for (const [frag, label] of [['#QQQQQQQQQQQQ', 'wrong version'], ['#not~valid~base42', 'damaged link'], ['', 'no payload']]) {
    await page.goto('about:blank'); await page.goto(BASE + '/play/' + frag, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await record(page, device, `play: error (${label})`)
  }

  await ctx.close()
}
await browser.close()

let clean = 0
for (const r of results) {
  if (!r.problems.length) { clean++; continue }
  console.log(`\n[${r.device}] ${r.screen}`)
  for (const p of r.problems) console.log('   - ' + p)
}
console.log(`\n${results.length} screen/device combinations, ${clean} clean`)
