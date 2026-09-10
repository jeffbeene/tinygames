// Wire format for the payload carried in the URL fragment.
//
//   byte 0        header: (FORMAT_VERSION << 4) | runtimeMode
//   bytes 1..n    Brotli-compressed UTF-8 source
//
// One byte of overhead buys forward compatibility and lets Play pick the right
// shell before it has looked at the code. At 1.5 chars/byte it costs 2
// characters out of ~4250 — cheaper than sniffing the source would be.

export const FORMAT_VERSION = 1

export const RUNTIME_HARNESS = 0
export const RUNTIME_BARE = 1

export const RUNTIME_LABEL = {
  [RUNTIME_HARNESS]: 'Canvas harness',
  [RUNTIME_BARE]: 'Bare page',
}

/**
 * @param {{ mode: number, compressed: Uint8Array }} parts
 * @returns {Uint8Array}
 */
export function packPayload({ mode, compressed }) {
  if (mode !== RUNTIME_HARNESS && mode !== RUNTIME_BARE) {
    throw new Error(`unknown runtime mode ${mode}`)
  }
  const out = new Uint8Array(compressed.length + 1)
  out[0] = (FORMAT_VERSION << 4) | mode
  out.set(compressed, 1)
  return out
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ mode: number, compressed: Uint8Array }}
 */
export function unpackPayload(bytes) {
  if (bytes.length < 2) throw new Error('payload is truncated')

  const version = bytes[0] >> 4
  const mode = bytes[0] & 0x0f

  if (version !== FORMAT_VERSION) {
    throw new Error(
      `this link was made with tinygames format v${version}, but this build reads v${FORMAT_VERSION}`,
    )
  }
  if (mode !== RUNTIME_HARNESS && mode !== RUNTIME_BARE) {
    throw new Error(`unknown runtime mode ${mode}`)
  }

  return { mode, compressed: bytes.subarray(1) }
}
