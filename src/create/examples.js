import { RUNTIME_HARNESS, RUNTIME_BARE } from '../shared/format.js'

const STARTER = `// tinygames — canvas harness
//
// Free, and costs you no budget: c (2d context), W, H, T (seconds since start),
// dt (seconds since last frame), F (frame count), K (keys held), M (mouse),
// snd(freq, secs), clear(color), rnd(n), and Math without the prefix
// (sin, cos, floor, min, max, hypot, PI, TAU...).
//
// Assign setup() to run once and draw() to run every frame.

let x, y, vx = 240, vy = 180, r = 20

setup = () => {
  x = W / 2
  y = H / 2
}

draw = () => {
  clear('#0b0d12')

  if (M.down) {
    vx = (M.x - x) * 2.5
    vy = (M.y - y) * 2.5
  }

  x += vx * dt
  y += vy * dt

  if (x < r) { x = r; vx = -vx; snd(300, .05) }
  if (x > W - r) { x = W - r; vx = -vx; snd(300, .05) }
  if (y < r) { y = r; vy = -vy; snd(200, .05) }
  if (y > H - r) { y = H - r; vy = -vy; snd(200, .05) }

  c.fillStyle = '#4ade80'
  c.beginPath()
  c.arc(x, y, r + sin(T * 6) * 2, 0, TAU)
  c.fill()

  c.fillStyle = '#59627a'
  c.font = '13px monospace'
  c.fillText('click to aim the ball', 14, 24)
}
`

const SNAKE = `// Snake — arrows or WASD to start and steer. Space to restart.

let G = 22, cols, rows, body, dir, queued, food, acc, dead, live, score, best = 0

setup = () => reset()
resized = () => reset()

function reset() {
  // Leave a margin so the wall is visible rather than flush to the screen edge.
  cols = max(10, floor((W - 28) / G))
  rows = max(10, floor((H - 28) / G))
  body = [[cols >> 1, rows >> 1]]
  dir = [1, 0]
  queued = [1, 0]
  acc = 0
  score = 0
  dead = false
  live = false
  drop()
}

function drop() {
  do food = [floor(rnd(cols)), floor(rnd(rows))]
  while (body.some(p => p[0] == food[0] && p[1] == food[1]))
}

function turn(x, y) {
  // No instant reversals: they would be an immediate self-collision.
  if (dir[0] != -x || dir[1] != -y) queued = [x, y]
  live = true
}

function step() {
  dir = queued
  let h = [body[0][0] + dir[0], body[0][1] + dir[1]]

  if (h[0] < 0 || h[1] < 0 || h[0] >= cols || h[1] >= rows ||
      body.some(p => p[0] == h[0] && p[1] == h[1])) {
    dead = true
    best = max(best, score)
    snd(90, .3, 'sawtooth')
    return
  }

  body.unshift(h)
  if (h[0] == food[0] && h[1] == food[1]) {
    score++
    snd(660 + score * 20, .07)
    drop()
  } else {
    body.pop()
  }
}

draw = () => {
  if (K.ArrowLeft || K.a) turn(-1, 0)
  if (K.ArrowRight || K.d) turn(1, 0)
  if (K.ArrowUp || K.w) turn(0, -1)
  if (K.ArrowDown || K.s) turn(0, 1)
  if (dead && (K.Space || M.down)) reset()

  // Nothing moves until the first steer, so it never dies unattended.
  if (live && !dead) {
    acc += dt
    let rate = max(.055, .13 - score * .003)
    while (acc >= rate) { acc -= rate; step(); if (dead) break }
  }

  clear('#0a0c11')

  let ox = (W - cols * G) / 2
  let oy = (H - rows * G) / 2

  c.strokeStyle = '#222b3a'
  c.lineWidth = 2
  c.strokeRect(ox - 2, oy - 2, cols * G + 4, rows * G + 4)

  c.fillStyle = '#ef4444'
  c.fillRect(ox + food[0] * G + 4, oy + food[1] * G + 4, G - 8, G - 8)

  for (let i = body.length; i--;) {
    c.fillStyle = i ? 'hsl(150 60% ' + (28 + 24 * (1 - i / body.length)) + '%)' : '#a7f3d0'
    c.fillRect(ox + body[i][0] * G + 1, oy + body[i][1] * G + 1, G - 2, G - 2)
  }

  // Inside the field: above it there may be no room at all on a short screen.
  c.fillStyle = '#3c4459'
  c.font = '13px monospace'
  c.fillText(score + '   best ' + best, ox + 7, oy + 19)

  if (!live || dead) {
    c.fillStyle = '#e5e7eb'
    c.font = 'bold 24px monospace'
    c.textAlign = 'center'
    c.fillText(dead ? 'dead — space to retry' : 'press an arrow key', W / 2, H / 2)
    c.textAlign = 'left'
  }
}
`

const JUMPER = `// Jumper — hold space or tap to fly through the gaps.

let y, v, pipes, score, best = 0, dead, gap = 150, spacing = 260, sx

setup = () => reset()

function reset() {
  y = H / 2
  v = 0
  sx = 0
  score = 0
  dead = false
  pipes = []
  for (let i = 0; i < 5; i++) pipes.push(spawn(W + i * spacing))
}

function spawn(x) {
  return { x, y: 70 + rnd(max(20, H - 140 - gap)), scored: false }
}

function die() {
  if (dead) return
  dead = true
  best = max(best, score)
  snd(120, .25, 'sawtooth')
}

draw = () => {
  let flap = K.Space || K.ArrowUp || K.w || M.down

  if (dead) {
    if (flap) reset()
  } else {
    v += 1500 * dt
    if (flap) v = -420
    y += v * dt

    let speed = 165 + score * 3
    sx += speed * dt

    for (let p of pipes) {
      p.x -= speed * dt
      if (p.x < -60) {
        p.x += 5 * spacing
        p.y = 70 + rnd(max(20, H - 140 - gap))
        p.scored = false
      }
      if (!p.scored && p.x + 30 < 90) { p.scored = true; score++; snd(880, .05) }
      if (abs(p.x - 90) < 46 && (y < p.y || y > p.y + gap)) die()
    }
    if (y > H - 12 || y < 0) die()
  }

  clear('#0e1016')

  c.fillStyle = '#171b25'
  for (let i = -1; i < W / 40 + 1; i++) c.fillRect(i * 40 - (sx % 40), H - 10, 22, 10)

  c.fillStyle = '#334155'
  for (let p of pipes) {
    c.fillRect(p.x, 0, 60, p.y)
    c.fillRect(p.x, p.y + gap, 60, H)
  }

  c.save()
  c.translate(90, y)
  c.rotate(max(-.5, min(.9, v / 700)))
  c.fillStyle = '#fbbf24'
  c.beginPath()
  c.arc(0, 0, 12, 0, TAU)
  c.fill()
  c.restore()

  c.fillStyle = '#94a3b8'
  c.font = 'bold 22px monospace'
  c.fillText(score, 14, 30)

  if (dead) {
    c.fillStyle = '#e2e8f0'
    c.font = 'bold 24px monospace'
    c.textAlign = 'center'
    c.fillText(score + ' — best ' + best, W / 2, H / 2 - 14)
    c.font = '15px monospace'
    c.fillText('tap or space to retry', W / 2, H / 2 + 16)
    c.textAlign = 'left'
  }
}
`

const BARE = `// Bare page — an empty document and nothing else. No canvas, no loop, no
// globals. The right choice when a game is DOM- or CSS-shaped rather than pixels.

document.body.style.cssText =
  'margin:0;height:100%;display:grid;place-items:center;background:#08090d;' +
  'color:#e8ebf2;font:500 16px/1.5 system-ui,sans-serif;user-select:none'

let wrap = document.createElement('div')
wrap.style.textAlign = 'center'
document.body.append(wrap)

let pad = document.createElement('button')
pad.style.cssText =
  'width:min(62vw,260px);aspect-ratio:1;border:0;border-radius:26px;' +
  'color:inherit;font:inherit;font-size:19px;cursor:pointer;transition:background .12s'

let label = document.createElement('p')
label.style.cssText = 'margin:18px 0 0;color:#77809a;font-size:14px'
wrap.append(pad, label)

let state = 'idle', t0 = 0, timer = 0, runs = []

function set(text, bg) {
  pad.textContent = text
  pad.style.background = bg
}

function idle() {
  state = 'idle'
  set('start', '#1e2532')
  label.textContent = runs.length
    ? 'best ' + Math.min(...runs) + ' ms · ' + runs.length + ' tries'
    : 'reaction test — tap the moment it turns green'
}

pad.onclick = () => {
  if (state === 'idle') {
    state = 'wait'
    set('wait…', '#7f1d1d')
    timer = setTimeout(() => {
      state = 'go'
      t0 = performance.now()
      set('NOW', '#15803d')
    }, 900 + Math.random() * 2200)
  } else if (state === 'wait') {
    clearTimeout(timer)
    state = 'idle'
    set('too soon', '#a16207')
    setTimeout(idle, 800)
  } else {
    let ms = Math.round(performance.now() - t0)
    runs.push(ms)
    state = 'idle'
    set(ms + ' ms', '#1d4ed8')
    setTimeout(idle, 1100)
  }
}

idle()
`

export const EXAMPLES = [
  { id: 'starter', name: 'Starter — bouncing ball', mode: RUNTIME_HARNESS, code: STARTER },
  { id: 'snake', name: 'Snake', mode: RUNTIME_HARNESS, code: SNAKE },
  { id: 'jumper', name: 'Jumper', mode: RUNTIME_HARNESS, code: JUMPER },
  { id: 'reaction', name: 'Reaction test (bare page)', mode: RUNTIME_BARE, code: BARE },
]

export const DEFAULT_EXAMPLE = EXAMPLES[0]
