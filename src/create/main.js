import { createEditor } from './editor.js'
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js'
import { RUNTIME_HARNESS, RUNTIME_BARE } from '../shared/format.js'
import { mountGameFrame, onFrameMessage } from '../shared/frame.js'
import { renderModules } from '../shared/qr-render.js'
import { ECC_NAME } from '../shared/qr-meta.js'
import CompileWorker from './compile.worker.js?worker'

const DRAFT_KEY = 'tinygames:draft'
const CAPACITY_KEY = 'tinygames:capacity'
const SPLIT_KEY = 'tinygames:split'
const COMPILE_DEBOUNCE = 350
const PREVIEW_DEBOUNCE = 700

const $ = (id) => document.getElementById(id)

const el = {
  examples: $('examples'),
  runtime: $('runtime'),
  autorun: $('autorun'),
  run: $('run'),
  stop: $('stop'),
  srcStat: $('src-stat'),
  problems: $('problems'),
  previewState: $('preview-state'),
  previewSource: $('preview-source'),
  frameHost: $('frame-host'),
  qrHolder: $('qr-holder'),
  budgetFill: $('budget-fill'),
  budgetTicks: $('budget-ticks'),
  budgetText: $('budget-text'),
  budgetPct: $('budget-pct'),
  statSymbol: $('stat-symbol'),
  statMin: $('stat-min'),
  statBr: $('stat-br'),
  statUrl: $('stat-url'),
  copyLink: $('copy-link'),
  savePng: $('save-png'),
  baseUrl: $('base-url'),
  qrExpand: $('qr-expand'),
  scanNote: $('scan-note'),
  lightbox: $('lightbox'),
  lightboxQr: $('lightbox-qr'),
  lightboxCaption: $('lightbox-caption'),
  lightboxClose: $('lightbox-close'),
  helpOpen: $('help-open'),
  help: $('help'),
  helpClose: $('help-close'),
}

// ---------------------------------------------------------------- worker ---

const worker = new CompileWorker()
const pending = new Map()
let nextId = 1

worker.onmessage = (e) => {
  const { id, ok, error, ...rest } = e.data
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  ok ? entry.resolve(rest) : entry.reject(Object.assign(new Error(error.message), error))
}

function call(op, args) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, op, ...args })
  })
}

// ----------------------------------------------------------------- state ---

const state = {
  source: '',
  mode: RUNTIME_HARNESS,
  baseUrl: `${location.origin}/play/`,
  /** Last successful compile; the QR keeps showing this while the source is mid-edit. */
  build: null,
  capacity: null,
  /** Monotonic guard so a slow compile cannot overwrite a newer one. */
  epoch: 0,
  frame: null,
  frameOffset: 0,
  runtimeErrors: [],
  problems: [],
  /** A one-off message, e.g. explaining that a remixed game arrives minified. */
  notice: null,
}

const prefix = () => `${state.baseUrl}#`
const fullUrl = () => (state.build ? prefix() + state.build.text : '')

const fmt = new Intl.NumberFormat()
const bytes = (n) => `${fmt.format(n)} B`

// ------------------------------------------------------------- capacity ----

// Calibration builds dozens of QR symbols, so it runs in the worker and its
// result is cached: it depends only on the URL prefix, which rarely changes.
async function recalibrate() {
  const key = prefix()

  try {
    const cached = JSON.parse(localStorage.getItem(CAPACITY_KEY) || 'null')
    if (cached?.key === key) {
      state.capacity = cached.value
      renderTicks()
      return
    }
  } catch {
    /* unreadable cache is not worth reporting; just measure again */
  }

  state.capacity = await call('calibrate', { prefix: key })
  renderTicks()

  try {
    localStorage.setItem(CAPACITY_KEY, JSON.stringify({ key, value: state.capacity }))
  } catch {
    /* storage unavailable -- calibration simply runs again next load */
  }
}

function renderTicks() {
  const { maxBytes, tiers } = state.capacity
  el.budgetTicks.replaceChildren(
    ...tiers
      .slice(0, -1)
      .filter((t) => t.maxBytes > 0 && t.maxBytes < maxBytes)
      .map((t) => {
        const tick = document.createElement('span')
        tick.className = 'budget-tick'
        tick.style.left = `${(t.maxBytes / maxBytes) * 100}%`
        tick.title = `${bytes(t.maxBytes)} — beyond here the code ${
          tiers[tiers.indexOf(t) + 1].label
        }`
        return tick
      }),
  )
}

// ------------------------------------------------------------- rendering ---

function setProblems(list) {
  if (!list.length) {
    el.problems.hidden = true
    el.problems.replaceChildren()
    return
  }
  el.problems.hidden = false
  el.problems.replaceChildren(
    ...list.map((p) => {
      const row = document.createElement('div')
      row.className = `problem problem-${p.kind}`
      const where = document.createElement('span')
      where.className = 'problem-where'
      where.textContent = p.line ? `line ${p.line}` : p.kind
      const msg = document.createElement('span')
      msg.className = 'problem-msg'
      msg.textContent = p.message
      row.append(where, msg)
      return row
    }),
  )
}

/** The strip shows a notice, compile problems, and runtime errors together. */
function refreshProblems() {
  setProblems([
    ...(state.notice ? [state.notice] : []),
    ...(state.problems ?? []),
    ...state.runtimeErrors,
  ])
}

function renderQrCard() {
  const build = state.build
  if (!build) return

  const { maxBytes, tiers } = state.capacity
  const over = build.payloadBytes > maxBytes
  const ratio = Math.min(build.payloadBytes / maxBytes, 1)

  el.budgetFill.style.width = `${ratio * 100}%`
  el.budgetPct.textContent = `${Math.round((build.payloadBytes / maxBytes) * 100)}%`
  el.budgetText.textContent = `${bytes(build.payloadBytes)} of ${bytes(maxBytes)}`

  if (over) {
    el.budgetFill.dataset.tier = 'over'
    el.qrHolder.replaceChildren(
      Object.assign(document.createElement('div'), {
        className: 'qr-over',
        textContent: `${bytes(build.payloadBytes - maxBytes)} too big for a QR code`,
      }),
    )
    el.statSymbol.textContent = 'over budget'
    el.scanNote.textContent = 'trim the game until it fits'
    el.scanNote.dataset.tier = 'over'
    el.copyLink.disabled = true
    el.savePng.disabled = true
    document.body.dataset.over = 'true'
    return
  }

  const result = build.qr
  if (!result) return

  state.qr = result
  el.budgetFill.dataset.tier = result.tier.key
  el.copyLink.disabled = false
  el.savePng.disabled = false
  delete document.body.dataset.over

  const canvas = renderModules(result, { targetPx: 420 })
  canvas.className = 'qr-canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', `QR code, version ${result.version}`)
  el.qrHolder.replaceChildren(canvas)

  el.statSymbol.textContent = `v${result.version} · ECC ${result.ecc} · ${result.count}²`
  el.scanNote.textContent = result.tier.label
  el.scanNote.dataset.tier = result.tier.key
  el.statMin.textContent = `${bytes(build.minifiedBytes)} from ${bytes(build.sourceBytes)}`
  el.statBr.textContent = `${bytes(build.compressedBytes)} · ${(
    build.minifiedBytes / Math.max(build.compressedBytes, 1)
  ).toFixed(2)}×`
  el.statUrl.textContent = `${fmt.format(fullUrl().length)} chars`
}

function updateSourceStat() {
  const lines = state.source.split('\n').length
  el.srcStat.textContent = `${fmt.format(state.source.length)} chars · ${lines} lines`
}

// --------------------------------------------------------------- preview ---

let previewTimer = 0

function runPreview() {
  clearTimeout(previewTimer)

  const useShipped = el.previewSource.value === 'shipped'
  const code = useShipped ? state.build?.minified : state.source
  if (typeof code !== 'string') return

  state.runtimeErrors = []
  refreshProblems()

  const { frame, lineOffset } = mountGameFrame(el.frameHost, { mode: state.mode, code })
  state.frameOffset = lineOffset
  state.frame = frame

  el.previewState.textContent = useShipped ? 'running shipped' : 'running'
  el.previewState.dataset.kind = 'live'
}

function stopPreview() {
  el.frameHost.replaceChildren()
  state.frame = null
  el.previewState.textContent = 'stopped'
  el.previewState.dataset.kind = 'idle'
}

function schedulePreview() {
  if (!el.autorun.checked) return
  clearTimeout(previewTimer)
  previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE)
}

onFrameMessage((msg) => {
  // A frame we already replaced can still be flushing errors.
  if (!state.frame || msg.source !== state.frame.contentWindow) return
  if (msg.kind === 'ready') return

  const line =
    typeof msg.line === 'number' && msg.line > 0 && el.previewSource.value !== 'shipped'
      ? msg.line
      : undefined

  state.runtimeErrors = [{ kind: msg.kind, message: msg.message, line }]
  refreshProblems()

  if (msg.kind === 'error') {
    el.previewState.textContent = 'crashed'
    el.previewState.dataset.kind = 'error'
  }
})

// --------------------------------------------------------------- compile ---

let compileTimer = 0

async function compileNow() {
  const epoch = ++state.epoch
  el.previewState.dataset.busy = 'true'

  try {
    const build = await call('compile', {
      source: state.source,
      mode: state.mode,
      prefix: prefix(),
    })
    if (epoch !== state.epoch) return

    state.build = build
    state.problems = []
    refreshProblems()
    renderQrCard()
  } catch (err) {
    if (epoch !== state.epoch) return
    // Keep the last good QR on screen: half-typed code should not blank it out.
    state.problems = [{ kind: 'syntax', message: err.message, line: err.line }]
    refreshProblems()
    el.previewState.textContent = 'syntax error'
    el.previewState.dataset.kind = 'error'
  } finally {
    if (epoch === state.epoch) delete el.previewState.dataset.busy
  }
}

function scheduleCompile() {
  clearTimeout(compileTimer)
  compileTimer = setTimeout(compileNow, COMPILE_DEBOUNCE)
}

// ----------------------------------------------------------- persistence ---

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ source: state.source, mode: state.mode, baseUrl: state.baseUrl }),
    )
  } catch {
    /* private mode, quota, or a browser with storage disabled -- not fatal */
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return typeof d?.source === 'string' ? d : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------ pane split ---

const workspace = document.querySelector('.workspace')
const splitter = $('splitter')

// Below these the panes stop being useful rather than merely tight: the editor
// loses the gutter plus a readable line, and the ship panel's container queries
// bottom out. They match the minmax() floors in the stylesheet.
const MIN_EDITOR = 320
const MIN_PREVIEW = 360

// Kept as a fraction, not pixels, so a resized window keeps the proportions the
// user chose instead of pinning the editor to the width it happened to have.
let splitWanted = 0.5

/** @returns {{ total: number, min: number, max: number } | null} null when the
 *  layout has stacked (or is too narrow to honour both minimums). */
function splitRange() {
  const total = workspace.clientWidth - splitter.offsetWidth
  if (!(total > 0)) return null
  const min = MIN_EDITOR / total
  const max = 1 - MIN_PREVIEW / total
  return min > max ? null : { total, min, max }
}

// Re-clamps the wanted fraction against the current window without overwriting
// it: dragging to the stop on a narrow window shouldn't lose the wider layout.
function layoutSplit() {
  const range = splitRange()
  if (!range) return
  const shown = Math.min(Math.max(splitWanted, range.min), range.max)
  workspace.style.setProperty('--split', `${(shown * range.total).toFixed(1)}px`)
  splitter.setAttribute('aria-valuenow', String(Math.round(shown * 100)))
}

function setSplit(fraction) {
  const range = splitRange()
  if (!range) return
  splitWanted = Math.min(Math.max(fraction, range.min), range.max)
  layoutSplit()
  try {
    localStorage.setItem(SPLIT_KEY, splitWanted.toFixed(4))
  } catch {
    /* same story as the draft -- a lost split is not worth failing over */
  }
}

splitter.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  // Capturing is what makes the drag survive crossing into the preview: the
  // game iframe is a separate document and would otherwise eat every move.
  splitter.setPointerCapture(e.pointerId)
  splitter.dataset.dragging = ''
  document.body.classList.add('is-resizing')
  e.preventDefault()
})

splitter.addEventListener('pointermove', (e) => {
  if (splitter.dataset.dragging == null) return
  const range = splitRange()
  if (!range) return
  const x = e.clientX - workspace.getBoundingClientRect().left - splitter.offsetWidth / 2
  setSplit(x / range.total)
})

// lostpointercapture fires for a normal release, a cancel and a lost capture
// alike, so it is the one place the drag has to be torn down.
splitter.addEventListener('lostpointercapture', () => {
  delete splitter.dataset.dragging
  document.body.classList.remove('is-resizing')
})

splitter.addEventListener('dblclick', () => setSplit(0.5))

splitter.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.05 : 0.01
  if (e.key === 'ArrowLeft') setSplit(splitWanted - step)
  else if (e.key === 'ArrowRight') setSplit(splitWanted + step)
  else return
  e.preventDefault()
})

addEventListener('resize', layoutSplit)

function restoreSplit() {
  try {
    const stored = Number(localStorage.getItem(SPLIT_KEY))
    if (stored > 0 && stored < 1) splitWanted = stored
  } catch {
    /* storage disabled -- the default split is a fine answer */
  }
  layoutSplit()
}

// ------------------------------------------------------------------ boot ---

const editor = createEditor($('editor'), {
  doc: '',
  onChange(doc) {
    state.source = doc
    if (state.notice?.kind === 'info') {
      state.notice = null
      refreshProblems()
    }
    updateSourceStat()
    saveDraft()
    scheduleCompile()
    schedulePreview()
  },
  onRun: runPreview,
})

function load({ source, mode }) {
  state.source = source
  state.mode = mode
  el.runtime.value = String(mode)
  editor.setValue(source)
  updateSourceStat()
  compileNow().then(runPreview)
}

async function boot() {
  restoreSplit()

  el.examples.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: 'Load…' }),
    ...EXAMPLES.map((ex) =>
      Object.assign(document.createElement('option'), { value: ex.id, textContent: ex.name }),
    ),
  )

  const draft = loadDraft()
  if (draft?.baseUrl) state.baseUrl = draft.baseUrl
  el.baseUrl.value = state.baseUrl
  await recalibrate()

  // A `#payload` on the editor means "remix this". Decode it, then drop it from
  // the address bar so the editor buffer is unambiguously the live document.
  const incoming = location.hash.slice(1)
  if (incoming) {
    try {
      const { mode, source } = await call('decode', { text: incoming })
      history.replaceState(null, '', location.pathname)
      load({ source, mode })
      // A QR code only ever carries the minified build, so this is the honest
      // state of what came back -- comments and original names are gone for good.
      state.notice = {
        kind: 'info',
        message:
          'Loaded from a link. QR codes carry only the minified build, so names ' +
          'are mangled and comments are gone — this is the real source of that game.',
      }
      refreshProblems()
      return
    } catch (err) {
      history.replaceState(null, '', location.pathname)
      state.notice = { kind: 'error', message: `Could not read that link: ${err.message}` }
      refreshProblems()
    }
  }

  load(draft ?? { source: DEFAULT_EXAMPLE.code, mode: DEFAULT_EXAMPLE.mode })
}

// ---------------------------------------------------------------- events ---

el.runtime.addEventListener('change', () => {
  state.mode = Number(el.runtime.value)
  saveDraft()
  compileNow()
  runPreview()
})

el.examples.addEventListener('change', () => {
  const ex = EXAMPLES.find((e) => e.id === el.examples.value)
  el.examples.value = ''
  if (!ex) return
  if (state.source.trim() && !confirm(`Replace the editor contents with "${ex.name}"?`)) return
  state.notice = null
  load({ source: ex.code, mode: ex.mode })
  saveDraft()
})

el.previewSource.addEventListener('change', runPreview)
el.run.addEventListener('click', runPreview)
el.stop.addEventListener('click', stopPreview)
el.autorun.addEventListener('change', () => el.autorun.checked && schedulePreview())

el.baseUrl.addEventListener('change', async () => {
  const next = el.baseUrl.value.trim()
  try {
    // Normalised so the prefix the QR encodes is exactly what is displayed.
    const url = new URL(next)
    url.hash = ''
    state.baseUrl = url.toString()
  } catch {
    el.baseUrl.value = state.baseUrl
    return
  }
  el.baseUrl.value = state.baseUrl
  saveDraft()
  await recalibrate()
  // The symbol is encoded against the prefix, so it has to be rebuilt too.
  compileNow()
})

el.copyLink.addEventListener('click', async () => {
  const url = fullUrl()
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    flash(el.copyLink, 'Copied')
  } catch {
    // Clipboard is gated on permissions and secure contexts; a prompt always works.
    prompt('Copy this link:', url)
  }
})

el.savePng.addEventListener('click', () => {
  if (!state.qr) return
  // Large enough that a printed code still has crisp module edges.
  const canvas = renderModules(state.qr, { targetPx: 1600 })
  canvas.toBlob((blob) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tinygame-v${state.qr.version}-${state.qr.ecc}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }, 'image/png')
})

function openLightbox() {
  if (!state.qr) return
  const canvas = renderModules(state.qr, { targetPx: 1200 })
  canvas.className = 'qr-canvas'
  el.lightboxQr.replaceChildren(canvas)
  el.lightboxCaption.textContent =
    `version ${state.qr.version} · ECC ${ECC_NAME[state.qr.ecc]} · ` +
    `${state.qr.count}×${state.qr.count} modules · ${state.qr.tier.label}`
  el.lightbox.hidden = false
}

el.qrExpand.addEventListener('click', openLightbox)
el.qrHolder.addEventListener('click', openLightbox)
el.lightboxClose.addEventListener('click', () => (el.lightbox.hidden = true))
el.lightbox.addEventListener('click', (e) => {
  if (e.target === el.lightbox) el.lightbox.hidden = true
})

function openHelp() {
  el.help.hidden = false
  el.help.querySelector('.modal-body').scrollTop = 0
  // The card takes focus so PageDown and Escape reach the dialog rather than
  // the editor, which is still sitting behind it and still focusable.
  el.help.querySelector('.modal-card').focus()
}

function closeHelp() {
  if (el.help.hidden) return
  el.help.hidden = true
  el.helpOpen.focus()
}

el.helpOpen.addEventListener('click', openHelp)
el.helpClose.addEventListener('click', closeHelp)
el.help.addEventListener('click', (e) => {
  if (e.target === el.help) closeHelp()
})

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  el.lightbox.hidden = true
  closeHelp()
})

function flash(button, text) {
  const original = button.textContent
  button.textContent = text
  button.disabled = true
  setTimeout(() => {
    button.textContent = original
    button.disabled = false
  }, 1200)
}

boot()
