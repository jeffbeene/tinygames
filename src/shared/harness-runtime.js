/*
 * The canvas harness. Imported with `?raw` and injected verbatim into the
 * sandboxed game frame, so it must be plain script: no imports, no exports.
 *
 * Everything defined here is free to the author -- it lives on the play page,
 * not in the QR code. That is the whole point of harness mode: a game pays no
 * budget for canvas setup, DPR handling, resize, an input map, or a frame loop.
 */
;(function () {
  'use strict'

  var canvas = document.createElement('canvas')
  canvas.id = 'g'
  document.body.appendChild(canvas)

  var ctx = canvas.getContext('2d')
  var W = 0
  var H = 0
  var lastW = 0
  var lastH = 0
  var lastDpr = 0
  var started = false

  /**
   * Syncs W/H and the backing store to the canvas's real box.
   * Returns false while the element still has no layout, which happens during
   * the document's initial parse -- starting then would hand setup() zeroes.
   */
  function measure() {
    var w = Math.round(canvas.clientWidth)
    var h = Math.round(canvas.clientHeight)
    if (w <= 0 || h <= 0) return false

    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    var changed = w !== lastW || h !== lastH || dpr !== lastDpr
    lastW = w
    lastH = h
    lastDpr = dpr

    W = w
    H = h
    window.W = W
    window.H = H

    // Only reallocate when something actually changed: assigning canvas.width
    // clears the bitmap and resets every context property.
    if (changed) {
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      // Draw in CSS pixels; the backing store stays crisp on retina displays.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (started && typeof window.resized === 'function') {
        try { window.resized() } catch (e) { window.__tgError(e) }
      }
    }
    return true
  }

  var keys = Object.create(null)
  var mouse = { x: 0, y: 0, down: false, px: 0, py: 0 }

  // A key tapped and released between two frames would never be visible to
  // draw(), which only ever sees held state. So releases that land in the same
  // frame as their press are deferred until one frame has observed them --
  // otherwise fast taps are silently dropped.
  var downFrame = Object.create(null)
  var deferredReleases = []
  var frameCount = 0

  var namesFor = function (e) {
    var names = [e.code]
    if (e.key) names.push(e.key.length === 1 ? e.key.toLowerCase() : e.key)
    return names
  }

  function release(names) {
    for (var i = 0; i < names.length; i++) keys[names[i]] = false
  }

  function setKey(e, held) {
    // Both spellings are populated so `K.ArrowUp` and `K.w` both work.
    var names = namesFor(e)
    if (held) {
      for (var i = 0; i < names.length; i++) keys[names[i]] = true
      downFrame[e.code] = frameCount
    } else if (downFrame[e.code] === frameCount) {
      deferredReleases.push(names)
    } else {
      release(names)
    }
    // Stop the arrows and space from scrolling the frame under the game.
    if (/^(Arrow|Space|Tab)/.test(e.code)) e.preventDefault()
  }

  addEventListener('keydown', function (e) { if (!e.repeat) setKey(e, true) }, { passive: false })
  addEventListener('keyup', function (e) { setKey(e, false) }, { passive: false })
  addEventListener('blur', function () {
    for (var k in keys) keys[k] = false
    deferredReleases.length = 0
  })

  function pointer(e, down) {
    var r = canvas.getBoundingClientRect()
    var t = e.touches && e.touches[0] ? e.touches[0] : e
    mouse.px = mouse.x
    mouse.py = mouse.y
    mouse.x = t.clientX - r.left
    mouse.y = t.clientY - r.top
    if (down !== undefined) mouse.down = down
  }

  var downAtFrame = -1
  var releasePointer = false

  addEventListener('pointermove', function (e) { pointer(e) })
  addEventListener('pointerdown', function (e) { pointer(e, true); downAtFrame = frameCount })
  addEventListener('pointerup', function () {
    // Same one-frame latch as the keyboard: a quick tap must survive to draw().
    if (downAtFrame === frameCount) releasePointer = true
    else mouse.down = false
  })
  addEventListener('pointercancel', function () { mouse.down = false; releasePointer = false })
  addEventListener('contextmenu', function (e) { e.preventDefault() })

  // --- audio ---------------------------------------------------------------
  // Autoplay policy requires a gesture, so the context is created lazily and
  // resumed on the first input of any kind.
  var actx = null
  function audio() {
    var AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!actx) actx = new AC()
    if (actx.state === 'suspended') actx.resume()
    return actx
  }
  addEventListener('pointerdown', audio)
  addEventListener('keydown', audio)

  /** snd(freq, seconds, type, gain) -- one short tone, enough for blips and thuds. */
  function snd(freq, dur, type, gain) {
    var a = audio()
    if (!a) return
    var t = a.currentTime
    var osc = a.createOscillator()
    var amp = a.createGain()
    osc.type = type || 'square'
    osc.frequency.value = freq || 440
    dur = dur || 0.08
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(gain === undefined ? 0.2 : gain, t + 0.005)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(amp).connect(a.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  // --- globals handed to the author ---------------------------------------
  window.c = ctx
  window.K = keys
  window.M = mouse
  window.T = 0
  window.dt = 0
  window.F = 0
  window.snd = snd
  window.rnd = function (n) { return Math.random() * (n === undefined ? 1 : n) }
  window.clear = function (fill) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H) }
    else ctx.clearRect(0, 0, W, H)
  }

  // Math without the `Math.` prefix -- pure budget savings for the author.
  ;['sin', 'cos', 'tan', 'atan2', 'abs', 'min', 'max', 'floor', 'ceil', 'round',
    'sqrt', 'hypot', 'pow', 'sign', 'random'].forEach(function (k) {
    window[k] = Math[k]
  })
  window.PI = Math.PI
  window.TAU = Math.PI * 2

  var running = false
  var start = 0
  var last = 0

  function frame(now) {
    if (!running) return
    if (!start) { start = now; last = now }
    window.dt = Math.min((now - last) / 1000, 0.1) // clamp so tab-switches don't teleport
    window.T = (now - start) / 1000
    window.F++
    frameCount++
    last = now

    var draw = window.draw
    if (typeof draw === 'function') {
      try {
        draw()
      } catch (e) {
        running = false
        window.__tgError(e)
        return
      }
    }

    // The frame has now seen any same-frame press, so it is safe to let go.
    for (var i = 0; i < deferredReleases.length; i++) release(deferredReleases[i])
    deferredReleases.length = 0
    if (releasePointer) { mouse.down = false; releasePointer = false }

    requestAnimationFrame(frame)
  }

  function begin() {
    if (started) return
    started = true

    // Last resort: a container that is genuinely zero-sized should still run
    // rather than hang, so give the author something non-zero to divide by.
    if (!W || !H) {
      W = window.W = Math.max(1, W)
      H = window.H = Math.max(1, H)
    }

    if (typeof window.setup === 'function') {
      try { window.setup() } catch (e) { return window.__tgError(e) }
    }
    if (typeof window.draw !== 'function') {
      window.__tgWarn(
        'Nothing is drawing yet. Assign a function to `draw` and it will run every frame.',
      )
    }
    running = true
    requestAnimationFrame(frame)
  }

  window.__tgStart = function () {
    addEventListener('resize', measure)

    // A window resize is not the only way the canvas box can change -- in the
    // editor the iframe is resized by the parent's layout. ResizeObserver
    // catches every case, including the very first time it gains a size.
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(function () {
          if (measure() && !started) begin()
        }).observe(canvas)
      } catch (e) { /* older engine; the polling below still covers us */ }
    }

    // Wait for real dimensions before setup(), so games that size themselves
    // from W/H (a grid, a play area) are not built against zeroes.
    var attempts = 0
    ;(function waitForLayout() {
      if (started) return
      if (measure() || attempts++ > 90) begin()
      else requestAnimationFrame(waitForLayout)
    })()
  }

  window.__tgStop = function () { running = false }
})()
