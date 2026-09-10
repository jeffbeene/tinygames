// Paints a module bitmap onto a canvas. Deliberately separate from the encoder:
// the main thread renders, the worker encodes, and neither loads the other's code.

/**
 * @param {{ modules: Uint8Array, count: number }} bitmap
 * @param {{ targetPx?: number, margin?: number, dark?: string, light?: string }} opts
 * @returns {HTMLCanvasElement}
 */
export function renderModules({ modules, count }, { targetPx = 400, margin = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const total = count + margin * 2
  // Integer module size only. Fractional scaling blurs module edges, which is
  // precisely what decoders tolerate least.
  const scale = Math.max(1, Math.ceil(targetPx / total))
  const px = total * scale

  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = dark

  for (let r = 0; r < count; r++) {
    const row = r * count
    for (let col = 0; col < count; col++) {
      if (modules[row + col]) {
        ctx.fillRect((col + margin) * scale, (r + margin) * scale, scale, scale)
      }
    }
  }
  return canvas
}
