// QR construction and capacity calibration. Runs in the worker: a v40 symbol
// takes ~20 ms to build and calibration builds dozens of them, which is far too
// much to spend on the thread that has to stay responsive to typing.
//
// Every symbol is built from two segments:
//   1. the URL prefix, in byte mode (it contains '#', which alphanumeric lacks)
//   2. the base42 payload, in alphanumeric mode at 5.5 bits/char
// Mixing modes within one symbol is standard and universally supported. The byte
// prefix costs about 44 characters of alphanumeric budget -- roughly 1% of v40-L.

import qrcode from 'qrcode-generator'
import { encodedLength } from './base42.js'
import { MAX_VERSION, TIERS, tierFor, versionOf } from './qr-meta.js'

/** Strongest first; the first level that stays inside the tier wins. */
const ECC_BOOST_ORDER = ['H', 'Q', 'M']

function tryBuild(prefix, data, version, ecc) {
  try {
    const qr = qrcode(version, ecc)
    qr.addData(prefix, 'Byte')
    if (data) qr.addData(data, 'Alphanumeric')
    qr.make()
    return qr
  } catch {
    return null
  }
}

/** Minimum version holding `chars` alphanumeric characters after `prefix`, or Infinity. */
function minVersion(prefix, chars) {
  const qr = tryBuild(prefix, 'A'.repeat(chars), 0, 'L')
  return qr ? versionOf(qr.getModuleCount()) : Infinity
}

/** Largest n in [0, hi] satisfying the monotonically-decreasing predicate `ok`. */
function searchMax(hi, ok) {
  let lo = 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ok(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Measures what a given URL prefix leaves for the payload, and where the symbol
 * crosses from one scannability tier into the next. Depends only on the prefix,
 * so callers should cache the result.
 *
 * @param {string} prefix
 */
export function calibrate(prefix) {
  const maxChars = searchMax(4296, (n) => tryBuild(prefix, 'A'.repeat(n), MAX_VERSION, 'L') !== null)
  const maxBytes = searchMax(4296, (n) => encodedLength(n) <= maxChars)

  const tiers = TIERS.map((t) => ({
    ...t,
    maxBytes:
      t.maxVersion >= MAX_VERSION
        ? maxBytes
        : searchMax(maxBytes, (n) => minVersion(prefix, encodedLength(n)) <= t.maxVersion),
  }))

  return { maxBytes, maxChars, tiers }
}

/** Flattens a built symbol into a row-major bitmap that can be transferred cheaply. */
function toModules(qr) {
  const count = qr.getModuleCount()
  const modules = new Uint8Array(count * count)
  for (let r = 0; r < count; r++) {
    for (let col = 0; col < count; col++) {
      modules[r * count + col] = qr.isDark(r, col) ? 1 : 0
    }
  }
  return { modules, count }
}

/**
 * Picks the symbol for a payload: the smallest version that holds it, then the
 * strongest error correction that fits *at that same version*. This is the
 * standard "boost ECL" behaviour, and it is chosen deliberately.
 *
 * Module count, not error correction, is what decides whether a phone can read a
 * code: at a fixed physical size, more modules means smaller ones. So the version
 * is minimised first, unconditionally, and error correction is upgraded only when
 * it is genuinely free. In practice that means the level is often L, because a
 * minimum-version symbol is tightly packed by definition -- the upgrade only
 * lands when the payload happens to fall just inside a version's capacity.
 *
 * The tempting alternative -- spend leftover budget on error correction, allowing
 * a larger version -- was tried and rejected: it makes symbol size non-monotonic
 * in payload size, so deleting code could make the QR bigger.
 *
 * @param {string} prefix
 * @param {string} payloadText base42
 * @returns {{ modules: Uint8Array, count: number, version: number, ecc: string, tier: object } | null}
 */
export function buildQR(prefix, payloadText) {
  const atL = tryBuild(prefix, payloadText, 0, 'L')
  if (!atL) return null

  const version = versionOf(atL.getModuleCount())

  let best = atL
  let ecc = 'L'
  for (const level of ECC_BOOST_ORDER) {
    const candidate = tryBuild(prefix, payloadText, version, level)
    if (candidate) {
      best = candidate
      ecc = level
      break
    }
  }

  return { ...toModules(best), version, ecc, tier: tierFor(version) }
}
