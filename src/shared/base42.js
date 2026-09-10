// Base42 — binary → text that is legal in *both* a QR alphanumeric segment and
// a URL fragment, with no escaping in either direction.
//
// QR's alphanumeric mode packs 2 characters into 11 bits (5.5 bits/char) but
// only accepts these 45: 0-9 A-Z space $ % * + - . / :
// Three of those are unusable in a URL, so we drop them:
//   '%'   introduces a percent-escape
//   ' '   must be percent-encoded
//   '+'   application/x-www-form-urlencoded decoders turn it into a space
// That leaves 42 symbols. Because 42^3 = 74088 >= 65536, two bytes still fit in
// three characters — identical density to RFC 9285 Base45, without the hazards.
// A trailing odd byte takes two characters (42^2 = 1764 >= 256).
//
// Cost: 1.5 characters per byte, so v40-L's 4296 characters carry ~2864 bytes.
// Base64 in QR byte mode would carry only ~2214. Percent-encoded binary, far less.

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*-./:'

const VALUES = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i
  return t
})()

/** Characters needed to encode `n` bytes. */
export function encodedLength(n) {
  return ((n >> 1) * 3) + ((n & 1) * 2)
}

/** Bytes that fit in `n` characters. */
export function decodedCapacity(n) {
  return ((n / 3) | 0) * 2 + ((n % 3 === 2) ? 1 : 0)
}

/** @param {Uint8Array} bytes @returns {string} */
export function encode(bytes) {
  const out = new Array(encodedLength(bytes.length))
  let o = 0
  let i = 0
  for (; i + 1 < bytes.length; i += 2) {
    let v = (bytes[i] << 8) | bytes[i + 1]
    out[o++] = ALPHABET[v % 42]
    v = (v / 42) | 0
    out[o++] = ALPHABET[v % 42]
    out[o++] = ALPHABET[(v / 42) | 0]
  }
  if (i < bytes.length) {
    const v = bytes[i]
    out[o++] = ALPHABET[v % 42]
    out[o++] = ALPHABET[(v / 42) | 0]
  }
  return out.join('')
}

/** @param {string} text @returns {Uint8Array} */
export function decode(text) {
  const n = text.length
  if (n % 3 === 1) {
    throw new Error(`base42: length ${n} is not a valid encoding`)
  }

  const digit = (k) => {
    const code = text.charCodeAt(k)
    const v = code < 128 ? VALUES[code] : -1
    if (v < 0) throw new Error(`base42: illegal character ${JSON.stringify(text[k])} at ${k}`)
    return v
  }

  const out = new Uint8Array(decodedCapacity(n))
  let o = 0
  let i = 0
  for (; i + 2 < n; i += 3) {
    const v = digit(i) + digit(i + 1) * 42 + digit(i + 2) * 1764
    if (v > 0xffff) throw new Error(`base42: group at ${i} overflows two bytes`)
    out[o++] = v >> 8
    out[o++] = v & 0xff
  }
  if (i < n) {
    const v = digit(i) + digit(i + 1) * 42
    if (v > 0xff) throw new Error(`base42: final group overflows one byte`)
    out[o++] = v
  }
  return out
}
