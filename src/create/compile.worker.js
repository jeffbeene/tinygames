// Minify -> compress -> measure, off the main thread. Terser over ~10 KB of
// source and Brotli at quality 11 are each slow enough to stutter typing if run
// inline. The same worker also decodes incoming links so the editor never needs
// a second copy of the Brotli wasm.

import { minify } from 'terser'
import { encode, decode } from '../shared/base42.js'
import { packPayload, unpackPayload, RUNTIME_HARNESS } from '../shared/format.js'
import { buildQR, calibrate } from '../shared/qr.js'

let brotliPromise = null
const brotli = () => (brotliPromise ??= import('brotli-wasm').then((m) => m.default))

// Names the harness looks up on `window` after the author's script runs.
// Toplevel mangling would rename `let draw = ...` and toplevel compression would
// drop it as unused, so both are pinned.
const RUNTIME_ENTRY_POINTS = ['draw', 'setup', 'resized']

async function minifySource(source, mode) {
  const result = await minify(source, {
    ecma: 2020,
    module: false,
    // Renaming across the top level is most of the win for a single-file
    // program, so it stays on for both runtimes.
    toplevel: true,
    compress: {
      passes: 3,
      unsafe_arrows: true,
      unsafe_math: true,
      unsafe_methods: true,
      pure_getters: true,
      top_retain: mode === RUNTIME_HARNESS ? RUNTIME_ENTRY_POINTS : null,
    },
    mangle: {
      toplevel: true,
      reserved: mode === RUNTIME_HARNESS ? RUNTIME_ENTRY_POINTS : [],
    },
    format: { comments: false, wrap_func_args: false },
  })
  if (typeof result.code !== 'string') throw new Error('minifier produced no output')
  return result.code
}

function describeError(err) {
  // Terser attaches line/col to syntax errors; surface them so the editor can
  // point at the offending line instead of just complaining.
  const line = typeof err.line === 'number' ? err.line : undefined
  const col = typeof err.col === 'number' ? err.col : undefined
  const message = (err.message || String(err)).replace(/\s*\(line \d+, col \d+.*?\)\s*$/i, '')
  return { message, line, col }
}

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

async function compile({ source, mode, prefix }) {
  const minified = await minifySource(source, mode)
  const { compress } = await brotli()

  const compressed = compress(utf8.encode(minified), { quality: 11 })
  const payload = packPayload({ mode, compressed })
  const text = encode(payload)

  return {
    minified,
    text,
    sourceBytes: utf8.encode(source).length,
    minifiedBytes: utf8.encode(minified).length,
    compressedBytes: compressed.length,
    payloadBytes: payload.length,
    // Built here as well, so the main thread only ever paints a bitmap.
    qr: buildQR(prefix, text),
  }
}

async function measure({ prefix }) {
  return calibrate(prefix)
}

async function decodeLink({ text }) {
  const { decompress } = await brotli()
  const { mode, compressed } = unpackPayload(decode(text.trim().toUpperCase()))
  return { mode, source: utf8Decoder.decode(decompress(compressed)) }
}

const OPS = { compile, decode: decodeLink, calibrate: measure }

self.onmessage = async (e) => {
  const { id, op, ...args } = e.data
  try {
    const handler = OPS[op]
    if (!handler) throw new Error(`unknown op ${op}`)
    const result = await handler(args)
    // The module bitmap can be large (v40 is 31 KB); hand off the buffer
    // instead of structured-cloning it.
    const transfer = result.qr ? [result.qr.modules.buffer] : []
    self.postMessage({ id, ok: true, ...result }, transfer)
  } catch (err) {
    self.postMessage({ id, ok: false, error: describeError(err) })
  }
}
