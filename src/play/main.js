// Play — the page a scanned QR code lands on.
//
// Read the fragment, base42-decode it, Brotli-decompress it, and boot the game
// edge to edge behind one welcome gate. Everything else stays behind a single
// unobtrusive corner button: the whole point is that scanning a code makes a
// game appear.

import { decode as base42Decode } from '../shared/base42.js'
import { unpackPayload, RUNTIME_LABEL } from '../shared/format.js'
import { mountGameFrame, onFrameMessage } from '../shared/frame.js'

const $ = (id) => document.getElementById(id)

const stage = $('stage')
const gate = $('gate')
const gateGo = $('gate-go')
const menuOpen = $('menu-open')
const sheet = $('sheet')

let game = null
let frame = null

function fail(title, message) {
  gate.hidden = true
  $('fail-title').textContent = title
  $('fail-msg').textContent = message
  $('fail').hidden = false
}

/** The payload is everything after '#', minus any trailing junk a scanner appended. */
function readPayload() {
  const raw = decodeURIComponent(location.hash.slice(1)).trim()
  // Some scanners uppercase or lowercase whole URLs; base42 is uppercase-only,
  // so normalising costs nothing and rescues those links.
  return raw.toUpperCase()
}

function start() {
  frame = mountGameFrame(stage, game).frame
  // Without this the game has no keyboard until the player thinks to click it,
  // which after dismissing the gate looks like the game ignoring them.
  frame.addEventListener('load', () => frame.focus(), { once: true })
}

/** Dismiss the gate and run the game. Nothing from the fragment executes before this. */
function launch() {
  if (!game || gate.hidden) return
  gate.hidden = true
  menuOpen.hidden = false
  start()
}

async function run() {
  const text = readPayload()

  if (!text) {
    fail('Nothing to play', 'This link has no game attached. Scan a tinygames QR code, or make one.')
    return
  }

  let payload
  try {
    payload = unpackPayload(base42Decode(text))
  } catch (err) {
    fail('That link is damaged', err.message)
    return
  }

  let source
  try {
    // Loaded only now, so the wasm fetch overlaps with the visitor reading the gate.
    const { decompress } = await import('brotli-dec-wasm/web').then(async (m) => {
      await m.default()
      return m
    })
    source = new TextDecoder().decode(decompress(payload.compressed))
  } catch (err) {
    fail('That link is damaged', `The compressed game could not be read. ${err.message ?? err}`)
    return
  }

  game = { mode: payload.mode, code: source }

  const stat =
    `${RUNTIME_LABEL[payload.mode]} · ${new Intl.NumberFormat().format(payload.compressed.length + 1)} ` +
    `bytes in the code · ${new Intl.NumberFormat().format(source.length)} chars of JavaScript`

  $('sheet-sub').textContent = stat
  $('act-remix').href = `/#${text}`

  // The size of what was in the code is the best argument the gate can make, so
  // it replaces the decoding notice rather than being buried in the menu.
  $('gate-meta').classList.add('is-ready')
  $('gate-status').textContent = stat
  gateGo.disabled = false
  gateGo.focus()
}

gateGo.addEventListener('click', launch)

// Games are sandboxed, so a crash cannot take the page with it -- but it should
// still say what happened rather than sitting on a black rectangle.
onFrameMessage((msg) => {
  if (msg.kind !== 'error' || !frame || msg.source !== frame.contentWindow) return
  const note = document.createElement('div')
  note.className = 'crash'
  note.textContent = `The game crashed: ${msg.message}`
  stage.append(note)
})

menuOpen.addEventListener('click', () => {
  sheet.hidden = false
})

$('sheet-close').addEventListener('click', () => (sheet.hidden = true))
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sheet.hidden = true
})

$('act-restart').addEventListener('click', () => {
  sheet.hidden = true
  if (game) start()
})

$('act-full').addEventListener('click', async () => {
  sheet.hidden = true
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* refused, or unsupported on this browser -- nothing useful to say */
  }
})

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sheet.hidden = true
})

// Re-scanning a different code in the same tab changes only the fragment. The
// reload also puts the gate back, which is the point: a new code is a new
// stranger's game.
addEventListener('hashchange', () => location.reload())

run()
