// Replicates the worker pipeline in Node so the whole chain can be checked
// without a browser: terser -> brotli -> base42 -> QR.
import { minify } from 'terser'
import zlib from 'node:zlib'
import qrcode from 'qrcode-generator'
import { encode, decode, encodedLength } from '../src/shared/base42.js'
import { packPayload, unpackPayload, RUNTIME_HARNESS } from '../src/shared/format.js'
import { EXAMPLES } from '../src/create/examples.js'

const ENTRY = ['draw', 'setup', 'resized']

async function minifySource(source, mode) {
  const r = await minify(source, {
    ecma: 2020,
    module: false,
    toplevel: true,
    compress: {
      passes: 3, unsafe_arrows: true, unsafe_math: true, unsafe_methods: true,
      pure_getters: true,
      top_retain: mode === RUNTIME_HARNESS ? ENTRY : null,
    },
    mangle: { toplevel: true, reserved: mode === RUNTIME_HARNESS ? ENTRY : [] },
    format: { comments: false, wrap_func_args: false },
  })
  return r.code
}

const br = (buf) => zlib.brotliCompressSync(buf, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
})

const PREFIX = 'http://localhost:5173/play/#'

function build(prefix, chars, ver, ecc) {
  try {
    const q = qrcode(ver, ecc)
    q.addData(prefix, 'Byte')
    if (chars) q.addData('A'.repeat(chars), 'Alphanumeric')
    q.make()
    return q
  } catch { return null }
}
const searchMax = (hi, ok) => { let lo = 0; while (lo < hi) { const m = (lo + hi + 1) >> 1; ok(m) ? lo = m : hi = m - 1 } return lo }

console.time('calibrate')
const maxChars = searchMax(4296, (n) => build(PREFIX, n, 40, 'L'))
const maxBytes = searchMax(4296, (n) => encodedLength(n) <= maxChars)
const tiers = [15, 24, 32].map((v) => searchMax(maxBytes, (n) => {
  const q = build(PREFIX, encodedLength(n), 0, 'L')
  return q && (q.getModuleCount() - 17) / 4 <= v
}))
console.timeEnd('calibrate')
console.log(`budget: ${maxBytes} bytes (${maxChars} chars) | tier ceilings v15/v24/v32 = ${tiers.join('/')} B\n`)

for (const ex of EXAMPLES) {
  const min = await minifySource(ex.code, ex.mode)
  const srcBytes = Buffer.byteLength(ex.code)
  const minBytes = Buffer.byteLength(min)
  const comp = br(Buffer.from(min))
  const payload = packPayload({ mode: ex.mode, compressed: comp })
  const text = encode(payload)

  // round-trip
  const back = unpackPayload(decode(text))
  const restored = zlib.brotliDecompressSync(Buffer.from(back.compressed)).toString()
  const roundTrip = restored === min && back.mode === ex.mode

  // entry points must survive mangling
  const needs = ex.mode === RUNTIME_HARNESS ? ENTRY.filter((k) => new RegExp(`\\b${k}\\s*=`).test(ex.code)) : []
  const kept = needs.filter((k) => new RegExp(`\\b${k}\\s*=`).test(min))

  // fits?
  const base = build(PREFIX, text.length, 0, 'L')
  const ver = base ? (base.getModuleCount() - 17) / 4 : null

  console.log(`${ex.name}`)
  console.log(`  source ${srcBytes} B -> minified ${minBytes} B -> brotli ${comp.length} B` +
              `  (${(srcBytes / comp.length).toFixed(1)}x overall)`)
  console.log(`  payload ${payload.length} B = ${(payload.length / maxBytes * 100).toFixed(1)}% of budget` +
              ` | url ${PREFIX.length + text.length} chars | QR v${ver}`)
  console.log(`  round-trip ${roundTrip ? 'OK' : 'FAILED'} | entry points ${needs.length ? kept.join(',') + ` (${kept.length}/${needs.length})` : 'n/a'}`)
  if (needs.length !== kept.length) console.log(`  !! LOST: ${needs.filter(k => !kept.includes(k)).join(', ')}`)
  console.log()
}

// How much source actually fits? Pad the starter until it stops fitting.
let unit = EXAMPLES[1].code
let reps = 1
while (true) {
  const src = Array.from({ length: reps }, (_, i) => unit.replace(/\b(cols|rows|body|dir|queued|food|acc|dead|score|best|G)\b/g, `$1_${i}`).replace(/^(setup|resized|draw) =/gm, `x${i} =`)).join('\n')
  const m = await minifySource(src, RUNTIME_HARNESS)
  if (br(Buffer.from(m)).length + 1 > maxBytes) break
  reps++
  if (reps > 40) break
}
console.log(`A v40-L QR holds about ${reps - 1}x the Snake example (~${((reps - 1) * Buffer.byteLength(unit) / 1024).toFixed(1)} KB of source).`)
