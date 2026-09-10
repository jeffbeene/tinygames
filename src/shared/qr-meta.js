// Facts about QR symbols that both the encoder (worker) and the UI (main thread)
// need. Kept dependency-free so importing it never pulls in the encoder.

export const MAX_VERSION = 40

export const ECC_NAME = { L: 'L (7%)', M: 'M (15%)', Q: 'Q (25%)', H: 'H (30%)' }

/**
 * How hard a symbol is to scan. This tracks module count far more closely than
 * error correction does: at a fixed physical size, more modules means smaller
 * ones, and small modules are what defeats a phone camera.
 */
export const TIERS = [
  { key: 'easy', maxVersion: 15, label: 'scans instantly' },
  { key: 'good', maxVersion: 24, label: 'scans easily' },
  { key: 'dense', maxVersion: 32, label: 'needs a steady camera' },
  { key: 'max', maxVersion: MAX_VERSION, label: 'hard from a phone screen' },
]

export const tierFor = (version) =>
  TIERS.find((t) => version <= t.maxVersion) ?? TIERS[TIERS.length - 1]

export const versionOf = (moduleCount) => (moduleCount - 17) / 4
