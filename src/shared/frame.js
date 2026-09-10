// Builds the sandboxed document a game runs inside, and reports its errors back
// to whoever embedded it. Used unchanged by both the editor preview and Play, so
// what you test is exactly what a scanner gets.

import harnessSource from './harness-runtime.js?raw'
import { RUNTIME_HARNESS } from './format.js'

// No allow-same-origin: the frame gets an opaque origin and cannot reach into
// the embedding page, its storage, or its cookies. Game code arriving from a URL
// is untrusted by definition, so it never runs on our origin.
export const SANDBOX = 'allow-scripts allow-pointer-lock allow-orientation-lock allow-modals'

const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box }
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden }
  body { background: #000; color: #eee;
         font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace }
  canvas#g { display: block; width: 100%; height: 100%; touch-action: none }
`

// Reported errors travel as postMessage rather than being rendered in the frame,
// so the host decides how to present them.
const REPORTER = `
;(function () {
  var sent = 0
  function post(kind, message, line) {
    if (sent++ > 40) return
    try {
      parent.postMessage({ __tg: 1, kind: kind, message: String(message), line: line }, '*')
    } catch (e) {}
  }
  window.__tgError = function (e, line) {
    post('error', (e && e.stack) ? String(e.message || e) : e, line)
  }
  window.__tgWarn = function (m) { post('warn', m) }
  window.__tgReady = function () { post('ready', 'ok') }
  window.onerror = function (msg, src, lineno) {
    post('error', msg, typeof lineno === 'number' ? lineno - LINE_OFFSET : undefined)
    return false
  }
  addEventListener('unhandledrejection', function (e) {
    post('error', (e.reason && e.reason.message) || e.reason || 'unhandled rejection')
  })
})()
`

/** `</script` anywhere in author code would close our tag early. */
const guard = (code) => code.replace(/<\/(script)/gi, '<\/$1')

/**
 * @param {{ mode: number, code: string }} game
 * @returns {{ srcdoc: string, lineOffset: number }}
 *   `lineOffset` converts a document line number from window.onerror back into
 *   a line number in the author's own source.
 */
export function buildFrameDocument({ mode, code }) {
  const harness = mode === RUNTIME_HARNESS

  const head =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    `<style>${BASE_CSS}</style></head><body>\n`

  // Assembled in two halves so the exact line the author's code lands on is
  // known rather than guessed.
  const before =
    head +
    '<script>' + REPORTER.replace(/LINE_OFFSET/g, '__OFFSET__') + '<\/script>\n' +
    (harness ? '<script>' + harnessSource + '<\/script>\n' : '') +
    '<script>\n'

  const lineOffset = before.split('\n').length - 1

  const after =
    '\n<\/script>\n' +
    '<script>' +
    (harness ? 'window.__tgStart();' : '') +
    'window.__tgReady();' +
    '<\/script>\n</body></html>'

  return {
    srcdoc: before.replace('__OFFSET__', String(lineOffset)) + guard(code) + after,
    lineOffset,
  }
}

/**
 * Creates a fresh sandboxed iframe, *without* content.
 *
 * The document is deliberately not attached here. A srcdoc document begins
 * parsing the moment it is set, and if the iframe element has not been laid out
 * yet the child's layout viewport is 0x0 -- so anything measuring itself during
 * parse (a canvas at `width:100%`, or `innerWidth` in bare mode) reads zero.
 * Use `mountGameFrame`, which attaches the document only once the element has a
 * real box.
 *
 * @param {{ mode: number, code: string }} game
 */
export function createGameFrame(game) {
  const { srcdoc, lineOffset } = buildFrameDocument(game)
  const frame = document.createElement('iframe')
  frame.className = 'game-frame'
  frame.setAttribute('sandbox', SANDBOX)
  frame.setAttribute('title', 'game')
  frame.setAttribute('allow', 'autoplay; fullscreen; gamepad')
  return { frame, lineOffset, attach: () => { frame.srcdoc = srcdoc } }
}

/**
 * Replaces `host`'s contents with a fresh game frame and boots it once the
 * element has been laid out. Always replace the element rather than reassigning
 * srcdoc -- a new frame is the only reliable way to reset every timer, listener
 * and audio node a game left behind.
 *
 * @param {HTMLElement} host
 * @param {{ mode: number, code: string }} game
 */
export function mountGameFrame(host, game) {
  const { frame, lineOffset, attach } = createGameFrame(game)
  host.replaceChildren(frame)

  let tries = 0
  const boot = () => {
    // getBoundingClientRect forces layout, so a non-zero box here means the
    // child will parse against real dimensions.
    const box = frame.getBoundingClientRect()
    if ((box.width > 0 && box.height > 0) || tries++ > 30 || !frame.isConnected) {
      attach()
    } else {
      requestAnimationFrame(boot)
    }
  }
  boot()

  return { frame, lineOffset }
}

/**
 * Subscribes to the diagnostics posted by game frames.
 * @param {(msg: { kind: string, message: string, line?: number, source: any }) => void} handler
 */
export function onFrameMessage(handler) {
  const listener = (e) => {
    const d = e.data
    // `source` lets callers drop messages from a frame they have already
    // replaced, which happens constantly while typing.
    if (d && d.__tg === 1) handler({ ...d, source: e.source })
  }
  addEventListener('message', listener)
  return () => removeEventListener('message', listener)
}
