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

const DOOM = `// Doom-ish — WASD to move, A/D or arrows to turn, space or click to shoot.
//
// A textured raycaster. The arena, the wall texture and the monster are all
// generated from one hash function at startup, so the game carries no map and
// no image data at all — which is the only way art fits inside a QR code.

let S = 64, N = 24

// Deterministic value hash. Not real noise, but with a pixel of grain on top,
// nothing about it reads as regular.
let hash = (x, y) => ((sin(x * 127.1 + y * 311.7) * 43758.5) % 1 + 1) % 1

// The arena is generated, not stored: pillars scattered through a walled hall.
// Everything outside the hall is solid, so a ray can never escape into an
// endless DDA loop.
let t = (x, y) => x < 1 || y < 1 || x > N - 2 || y > N - 2 ||
  hash(x * 5, y * 5) > .74 ? 1 : 0

// -- procedural art --------------------------------------------------------

// One offscreen canvas per material, painted by a pixel function. A returned
// 4th component is alpha, which is what lets the same generator do sprites too.
function tex(f) {
  let k = document.createElement('canvas')
  k.width = k.height = S
  let g = k.getContext('2d'), d = g.createImageData(S, S), p = d.data
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = f(x, y), i = y * S + x << 2
    p[i] = v[0]
    p[i + 1] = v[1]
    p[i + 2] = v[2]
    p[i + 3] = v[3] > 0 ? 255 : 0
  }
  g.putImageData(d, 0, 0)
  return k
}

// Brick: 8px courses, every other one offset by half a brick.
let WALL = tex((x, y) => {
  let r = y >> 3, b = x + r % 2 * 8, g = hash(x, y) * 16
  if (y % 8 < 1 || b % 16 < 1) return [52 + g, 48 + g, 46 + g, 1]
  let n = hash((b >> 4) * 7, r)
  return [112 + n * 44 + g, 48 + n * 20 + g, 38 + g, 1]
})

// The monster: a body blob, a head, two hot eyes. The hash eats into the
// outline so it reads as a creature rather than a cutout. The hot palette is the frame
// after you hit it — the same generator, run once more with the palette up.
let mob = (hot) => tex((x, y) => {
  let u = x / S * 2 - 1, v = y / S * 2 - 1, n = hash(x, y)
  if (hypot(u / .5, (v - .5) / .62) + n * .13 > 1 &&
      hypot(u / .3, (v + .42) / .32) + n * .1 > 1) return [0, 0, 0, 0]
  if (hypot(abs(u) - .13, v + .47) < .075) return [255, 40 + n * 50, 30, 1]
  let s = 58 + n * 40 - v * 28
  return hot ? [240, 90 + s * .4, 70, 1] : [s * .68, s * 1.14, s * .5, 1]
})

let MOB = [mob(0), mob(1)]

// -- game ------------------------------------------------------------------

let D = 2, P, E, zbuf = [], a, hp, kills, cd, fl, ouch, bob, over, mx0

setup = () => { cfg(); reset() }

// A canvas resize resets every context property, so the crisp-pixel flag has to
// be set here and not once in setup(): without it the 1px slices bleed.
resized = cfg
function cfg() { c.imageSmoothingEnabled = false }

// A random open cell, optionally kept clear of the player. Bounded, because an
// unlucky arena must not be able to hang the game.
function place(away) {
  let x, y, n = 0
  do {
    x = rnd(N)
    y = rnd(N)
  } while (n++ < 99 && (t(floor(x), floor(y)) || away && hypot(x - P.x, y - P.y) < away))
  return { x, y }
}

function mob2() {
  let e = place(8)
  e.hp = 3
  e.hit = 0
  E.push(e)
}

// Is the cell r cells ahead of the player solid?
let ahead = (r) => t(floor(P.x + cos(a) * r), floor(P.y + sin(a) * r))

function reset() {
  P = place(0)
  // Turn until the floor ahead is clear, so you never open your eyes with your
  // nose against a pillar. One probe is not enough: a pillar one cell away can
  // fill the screen with open floor visible behind it. Bounded, like place().
  for (a = 0; a < 7 && (ahead(1) || ahead(2.5)); a += .4) ;
  hp = 100
  kills = cd = fl = ouch = bob = 0
  over = false
  mx0 = M.x
  E = []
  while (E.length < 5) mob2()
}

// Axes resolve separately so a wall taken at an angle slides you along it, and
// the probe leads the move so you cannot clip a corner.
function move(o, nx, ny) {
  if (!t(floor(nx + (nx > o.x ? .2 : -.2)), floor(o.y))) o.x = nx
  if (!t(floor(o.x), floor(ny + (ny > o.y ? .2 : -.2)))) o.y = ny
}

// Camera-space position of a world point: x across the view plane, y the
// perpendicular depth — the same units the wall depth buffer holds.
function view(e, dx, dy, px, py) {
  let ox = e.x - P.x, oy = e.y - P.y, k = 1 / (px * dy - dx * py)
  return [k * (dy * ox - dx * oy), k * (px * oy - py * ox)]
}

draw = () => {
  // --- input
  if (M.down) a += (M.x - mx0) * .005
  mx0 = M.x
  if (K.a || K.ArrowLeft) a -= 2.2 * dt
  if (K.d || K.ArrowRight) a += 2.2 * dt

  let dx = cos(a), dy = sin(a), px = -dy * .72, py = dx * .72
  let f = (K.w || K.ArrowUp ? 1 : 0) - (K.s || K.ArrowDown ? 1 : 0)

  cd -= dt
  fl = max(0, fl - dt)
  ouch = max(0, ouch - dt * 2)

  if (!over && f) {
    bob += dt
    move(P, P.x + dx * f * 2.7 * dt, P.y + dy * f * 2.7 * dt)
  }

  // --- monsters close in, then maul you at arm's length. The damage flash
  // doubles as the cooldown, so a swarm cannot delete you in one frame.
  for (let e of E) {
    e.hit = max(0, e.hit - dt)
    let d = max(.01, hypot(e.x - P.x, e.y - P.y))
    if (over || d > 14) continue
    if (d > .8) move(e, e.x + (P.x - e.x) * 1.2 * dt / d, e.y + (P.y - e.y) * 1.2 * dt / d)
    else if (!ouch) {
      ouch = 1
      snd(80, .22, 'sawtooth', .3)
      if ((hp -= 9) <= 0) {
        hp = 0
        over = true
        cd = 1
        snd(50, .9, 'sawtooth', .3)
      }
    }
  }

  // --- floor and ceiling, split at a horizon that bobs with your stride
  let hz = H / 2 + sin(bob * 9) * 3.5
  clear('#000')
  c.fillStyle = '#34281d'
  c.fillRect(0, hz, W, H - hz)

  // --- walls: one DDA per screen column, textured with a 1px source slice
  for (let x = 0, i = 0; x < W; x += D, i++) {
    let cam = 2 * x / W - 1
    let rx = dx + px * cam, ry = dy + py * cam
    let gx = floor(P.x), gy = floor(P.y)
    let ddx = abs(1 / rx), ddy = abs(1 / ry)
    let sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1
    let mx = (rx < 0 ? P.x - gx : gx + 1 - P.x) * ddx
    let my = (ry < 0 ? P.y - gy : gy + 1 - P.y) * ddy
    let side = 0, hit = 0, n = 0

    while (!hit && n++ < 64) {
      if (mx < my) { mx += ddx; gx += sx; side = 0 }
      else { my += ddy; gy += sy; side = 1 }
      hit = t(gx, gy)
    }

    let dist = max(.05, side ? my - ddy : mx - ddx)
    let h = H / dist, y0 = hz - h / 2
    zbuf[i] = dist

    // Where the ray met the wall, in texture columns; flipped on the faces seen
    // from the far side so the pattern never mirrors across a corner.
    let w = side ? P.x + dist * rx : P.y + dist * ry
    let tx = floor((w - floor(w)) * S)
    c.drawImage(WALL, (side ? ry < 0 : rx > 0) ? S - 1 - tx : tx, 0, 1, S, x, y0, D, h)

    // One translucent pass does two jobs: distance fog, and a fake light
    // direction — which is what stops corners reading as flat.
    c.fillStyle = 'rgba(0,0,0,' + min(.85, dist / 13 + (side ? .22 : 0)) + ')'
    c.fillRect(x, y0, D, h)
  }

  // Fired here rather than up with the rest of the input, so the hitscan can
  // test the depth buffer that this frame's walls have just filled in.
  if (!over && cd <= 0 && (K.Space || M.down)) {
    cd = .3
    fl = .07
    snd(160, .13, 'sawtooth', .3)
    let best, bz = 99
    for (let e of E) {
      let [ex, ez] = view(e, dx, dy, px, py)
      // Inside the crosshair cone, in front of you, and not behind a wall.
      if (ez > .3 && ez < bz && abs(ex / ez) < .16 && zbuf[W / D >> 1] > ez) {
        best = e
        bz = ez
      }
    }
    if (best) {
      best.hit = .12
      if (--best.hp > 0) snd(320, .07, 'square', .2)
      else {
        E.splice(E.indexOf(best), 1)
        kills++
        snd(70, .35, 'sawtooth', .3)
        mob2()
      }
    }
  }

  // --- monster billboards, far to near, clipped per column against the walls
  for (let [e, ex, ez] of E.map((e) => [e, ...view(e, dx, dy, px, py)]).sort((p, q) => q[2] - p[2])) {
    if (ez < .25) continue
    // fh is the full floor-to-ceiling height at that depth; the monster is a
    // little shorter than the room, and stands on the floor rather than being
    // centred on the horizon.
    let fh = H / ez, h = fh * .82, w = fh * .72, cx = W / 2 * (1 + ex / ez)
    c.globalAlpha = max(.05, 1 - ez / 14)
    for (let x = max(0, floor((cx - w / 2) / D) * D); x < min(W, cx + w / 2); x += D) {
      if (zbuf[x / D] > ez) {
        c.drawImage(MOB[e.hit ? 1 : 0], floor((x - cx + w / 2) / w * S), 0, 1, S,
                    x, hz + fh / 2 - h, D, h)
      }
    }
    c.globalAlpha = 1
  }

  // --- the muzzle flash lights the room, not just the gun
  c.fillStyle = 'rgba(255,190,90,' + fl * 2 + ')'
  c.fillRect(0, 0, W, H)

  // --- gun, kicked by the recoil and swayed by the walk
  let k = sin(bob * 9) * 6
  let gx = W / 2 + k, gy = H + k / 2 + (cd > .2 ? 20 : 0)
  c.fillStyle = '#12151c'
  c.fillRect(gx - 58, gy - 96, 116, 96)
  c.fillStyle = '#3b4252'
  c.fillRect(gx - 46, gy - 88, 92, 88)
  c.fillStyle = '#12151c'
  c.fillRect(gx - 13, gy - 148, 26, 60)
  c.fillStyle = '#5a6376'
  c.fillRect(gx - 13, gy - 148, 6, 60)
  if (fl) {
    c.fillStyle = 'rgba(255,214,120,' + fl * 11 + ')'
    c.beginPath()
    c.arc(gx, gy - 150, 22 + rnd(14), 0, TAU)
    c.fill()
  }

  // --- hud: damage flash, health bar, kill count, crosshair
  c.fillStyle = 'rgba(180,20,20,' + ouch * .45 + ')'
  c.fillRect(0, 0, W, H)
  c.fillStyle = '#0009'
  c.fillRect(12, 12, 100, 9)
  c.fillStyle = hp > 35 ? '#63d471' : '#ef4444'
  c.fillRect(12, 12, hp, 9)
  c.fillStyle = '#dfe4ee'
  c.font = 'bold 14px monospace'
  c.fillText(kills, 12, 38)
  c.fillRect(W / 2 - 7, hz - 1, 14, 2)
  c.fillRect(W / 2 - 1, hz - 7, 2, 14)

  if (over) {
    c.textAlign = 'center'
    c.font = 'bold 28px monospace'
    c.fillText('YOU DIED', W / 2, H / 2)
    c.textAlign = 'left'
    if (cd <= 0 && (K.Space || M.down)) reset()
  }
}
`

const CITY = `// Neon City — WASD or arrows to walk and turn. Drag to look, hold to walk.
//
// An endless cyberpunk city at night. Nothing is stored: every block, lot,
// storey, lit window and shop sign is derived from its coordinates by a hash
// and a one-line seeded PRNG, so a street corner looks the same on every visit
// and the city is as wide as the number line. The raycaster is the Doom-ish
// one, taught to look over rooftops.

let S = 64, FAR = 96, MAXN = 24   // texels per storey, fog distance, tallest tower

// A hash answers "what is at (x, y)?"; the PRNG (Park–Miller minimal standard)
// hands a generator a whole stream of decisions from one seed. Between them
// they replace every asset a game would normally ship.
let hash = (x, y, z = 0) => ((sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5) % 1 + 1) % 1
let s = 1, R = (n = 1) => (s = s * 16807 % 2147483647) / 2147483647 * n
let seed = (x, y, z) => s = 1 + hash(x, y, z) * 2e9 | 0
// A saturated colour from a hue in 0..6 — three cosines a third of a turn apart.
let hue = (h) => [0, 1, 2].map((i) => 128 + 127 * cos(h + i * 2.1) | 0)

// Shop names: two small word lists and five ways to join them.
let A = 'Neo Star Big Lucky Cyber Mega Kwik Robo Moon Hyper Zap Turbo Ultra Tokyo Data Astro Lazer Sky Red Blue Tiny'.split(' ')
let B = 'Mart Bank Noodle Burger Motel Sushi Pawn Bar Diner Clinic Cafe Taxi Arcade Loans Tattoo Ramen Grill Pizza Cuts Donut Hotel Tacos'.split(' ')
let name = () => {
  let a = A[R(A.length) | 0], b = B[R(B.length) | 0], f = R(5) | 0
  return f < 1 ? a + ' ' + b : f < 2 ? a + '-' + b : f < 3 ? a + "'s" : f < 4 ? a + "'s " + b : a + b.toLowerCase()
}

// -- procedural art --------------------------------------------------------

// Every texture lives in one atlas, stacked in 64px-wide columns. One canvas
// per building was tried first and fell off a cliff in Chrome: each offscreen
// canvas gets its own GPU surface, and past a few dozen the browser starts
// reading them back every frame. One source image is one binding.
let AT = document.createElement('canvas'), ag = AT.getContext('2d'), ax = 0, ay = 0, TQ = []
AT.width = 2048
AT.height = 4096

// Paint an S-wide, h-tall strip with a pixel function and return its atlas
// slot, with the raw bytes attached so the floor caster can sample them.
function tex(h, f) {
  let d = ag.createImageData(S, h), p = d.data
  p.fill(255)
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < S; x++, i += 4) {
    let v = f(x, y)
    p[i] = v[0]
    p[i + 1] = v[1]
    p[i + 2] = v[2]
  }
  if (ay + h > 4096) { ax += S; ay = 0 }
  // Atlas full: forget every facade and let the visible ones regenerate.
  if (ax >= 2048) { ax = ay = 0; for (let b of TQ) b.t = 0; TQ = [] }
  ag.putImageData(d, ax, ay)
  ay += h
  return { x: ax, y: ay - h, d: p }
}

seed(1, 2, 3)
// Asphalt: dark grain with the odd wet glint. Paving: lighter slabs on a grid.
let ASPH = tex(S, () => { let n = 22 + R(16) + (R() > .97) * 30; return [n, n, n + 5] })
let PAVE = tex(S, (x, y) => { let n = 46 + R(18) - (x % 16 < 1 || y % 16 < 1) * 22; return [n, n, n + 6] })

// A whole facade for one building: its storeys stacked top-down, ground floor
// last, plus a second ground floor carrying the shop sign when it has one.
// Every choice below comes from the building's seed, so the texture is only a
// cache — throw it away and the same one comes back.
function facade(b) {
  s = b.k
  let n = b.n, v = 22 + R(48)
  // Wall tone: a grey pushed towards brick, stone or blue glass; window light.
  let wall = [v + R(30), v + R(12), v + R(30)], lit = hue(R(6))
  // Window size and pitch, how many are lit, how rough the wall is, and whether
  // the corners are traced in neon. Style 1 is a glass tower, 2 is brick.
  let style = R(3) | 0, ww = style == 1 ? 7 : 3 + R(9) | 0, wh = 5 + R(11) | 0
  let px = style == 1 ? 8 : ww + 2 + R(8) | 0, py = wh + 4 + R(9) | 0, ox = S % px >> 1
  let p = .1 + R(.6), grain = 4 + R(24)
  let neon = R() < .3 && hue(R(6))
  let shop = R() < .5

  let k = tex(S * (n + b.s), (x, y) => {
    let st = y / S | 0, yy = y % S, g = R(grain) - grain / 2
    let m = st == 0 && yy < 3 ? .4 : yy < 2 ? .55 : 1   // parapet and floor slabs
    if (neon && st < n - 1 && (x < 1 || x > S - 2 || st == 0 && yy == 3)) return neon
    if (st >= n - 1) {
      if (st == n && yy > 2 && yy < 20) return [16, 10, 20]   // the sign's backboard
      if (shop && yy > 22 && x > 3 && x < S - 4) {
        // A glass front lit from inside, shelves and all, with a door.
        let d = x > 26 && x < 38 ? .1 : (yy - 22) % 9 < 2 ? .3 : .75
        return [lit[0] * d + g, lit[1] * d + g, lit[2] * d + g]
      }
      if (!shop && yy > 18 && x > 6 && x < S - 7) m = yy % 3 < 1 ? .5 : .8   // roller shutter
    } else if (x >= ox && (x - ox) % px < ww && yy > 3 && (yy - 4) % py < wh) {
      let i = (x - ox) / px | 0, j = (yy - 4) / py | 0, l = hash(i, j + st * 9, b.k)
      if (l < p) { let q = .55 + l / p * .45; return [lit[0] * q, lit[1] * q, lit[2] * q] }
      return [14 + g / 3, 18 + g / 3, 30 + g / 3]   // dark glass
    }
    if (style == 2 && (yy % 4 < 1 || (x + (yy >> 2) % 2 * 4) % 8 < 1)) m *= .6   // mortar
    return [wall[0] * m + g, wall[1] * m + g, wall[2] * m + g]
  })

  if (b.s) {
    let y = k.y + S * n
    ag.strokeStyle = ag.fillStyle = ag.shadowColor = 'rgb(' + hue(R(6)) + ')'
    ag.shadowBlur = 5
    ag.strokeRect(k.x + 2.5, y + 3.5, 59, 16)
    ag.font = ['bold 11px sans-serif', 'italic bold 11px serif', 'bold 10px monospace'][R(3) | 0]
    ag.textAlign = 'center'
    ag.fillText(name(), k.x + 32, y + 15, 56)
  }
  TQ.push(b)
  return b.t = k
}

// The night sky: a strip of stars the heading scrolls through.
let ST = document.createElement('canvas'), sg = ST.getContext('2d')
ST.width = 1024
ST.height = 256
for (let i = 0; i < 500; i++) {
  sg.fillStyle = 'rgba(255,255,255,' + R() + ')'
  sg.fillRect(R(1024), R(256), 1, i % 9 ? 1 : 2)
}

// -- the city --------------------------------------------------------------

// Blocks repeat every 16 cells: 12 of block, 4 of street. The outer ring of a
// block is sidewalk; the 10×10 inside is split into 3×3 lots by two cuts on
// each axis. A lot may sit back from its lines (which is where alleys come
// from) or stay empty. A low-frequency hash decides how tall the district
// builds, so downtown clusters rise out of low-rise sprawl.
let BL = new Map()
function blk(bx, by) {
  let key = bx * 1e5 + by, k = BL.get(key)
  if (k) return k
  seed(bx, by, 11)
  let tall = hash(bx >> 2, by >> 2, 5) ** 2 * MAXN
  k = { x: [1, 3 + R(3) | 0, 6 + R(3) | 0, 11], y: [1, 3 + R(3) | 0, 6 + R(3) | 0, 11], L: [] }
  for (let i = 0; i < 9; i++) {
    let x0 = k.x[i / 3 | 0] + (R() < .25), x1 = k.x[(i / 3 | 0) + 1] - (R() < .25)
    let y0 = k.y[i % 3] + (R() < .25), y1 = k.y[i % 3 + 1] - (R() < .25)
    let n = min(MAXN, 1 + R() * (2 + tall) | 0), shop = R() < .5
    k.L.push(R() < .12 || x1 <= x0 || y1 <= y0 ? 0 :
      { x0, x1, y0, y1, n, s: shop && R() < .6, k: 1 + R(2e9) | 0, t: 0 })
  }
  BL.set(key, k)
  return k
}

// Which building, if any, owns cell (x, y).
function cell(x, y) {
  let bx = floor(x / 16), by = floor(y / 16), u = x - bx * 16, v = y - by * 16
  if (u < 1 || u > 10 || v < 1 || v > 10) return 0
  let k = blk(bx, by)
  let b = k.L[(u < k.x[1] ? 0 : u < k.x[2] ? 1 : 2) * 3 + (v < k.y[1] ? 0 : v < k.y[2] ? 1 : 2)]
  return b && u >= b.x0 && u < b.x1 && v >= b.y0 && v < b.y1 ? b : 0
}

// -- render ----------------------------------------------------------------

let D, BV = 0, P = { x: 14, y: 13.2 }, a = 0, bob = 0, mx0 = 0, dn, fc, fg, fd, Wf, sky

setup = resized = () => {
  // A canvas resize resets every context property, so the crisp-pixel flag has
  // to be set here and not once in setup(). The floor is cast into a low-res
  // buffer at the same step as the wall columns and scaled up to match.
  c.imageSmoothingEnabled = false
  D = ceil(W / 480)
  Wf = ceil(W / D)
  fc = document.createElement('canvas')
  fc.width = Wf
  fc.height = ceil(H / 2 / D) + 6
  fg = fc.getContext('2d')
  fd = fg.createImageData(Wf, fc.height)
  fd.data.fill(255)
  sky = c.createLinearGradient(0, 0, 0, H / 2)
  sky.addColorStop(0, '#040310')
  sky.addColorStop(.7, '#140a2c')
  sky.addColorStop(1, '#4a1a4c')
}

// Draw texture rows sy..sy+sh onto screen rows ya..yb, cut off at the skyline.
// BV is the reflection's vertical smear. Two extra taps of the same slice, one
// either side at 1/2 then 1/3 alpha, leave the three offsets weighted evenly --
// a three-sample box blur for two more drawImage calls and no buffers.
function col(t, tx, sy, sh, x, ya, yb, top) {
  if (yb > top) { sh *= (top - ya) / (yb - ya); yb = top }
  if (yb > ya) {
    c.drawImage(AT, t.x + tx, t.y + sy, 1, sh, x, ya, D, yb - ya)
    for (let k = 2; BV && k < 4; k++) {
      c.globalAlpha = 1 / k
      c.drawImage(AT, t.x + tx, t.y + sy, 1, sh, x, ya + (k * 2 - 5) * BV, D, yb - ya)
    }
    c.globalAlpha = 1
  }
}

draw = () => {
  // --- input. A drag turns only once the pointer has been down for a frame,
  // so the first tap does not read as a jump from wherever the pointer last was.
  if (M.down && dn) a += (M.x - mx0) * .004
  dn = M.down
  mx0 = M.x
  a += ((K.d || K.ArrowRight ? 1 : 0) - (K.a || K.ArrowLeft ? 1 : 0)) * 2 * dt
  let f = (K.w || K.ArrowUp || M.down ? 1 : 0) - (K.s || K.ArrowDown ? 1 : 0)
  let dx = cos(a), dy = sin(a), px = -dy * .72, py = dx * .72
  if (f) {
    bob += dt
    // Not collision so much as manners: the probe leads by a shoulder's width
    // so you stop at a wall instead of pressing your eye into it.
    let nx = P.x + dx * f * 3.2 * dt, ny = P.y + dy * f * 3.2 * dt
    if (!cell(floor(nx + sign(dx * f) * .25), floor(P.y))) P.x = nx
    if (!cell(floor(P.x), floor(ny + sign(dy * f) * .25))) P.y = ny
  }
  let hz = H / 2 + sin(bob * 8) * 3 | 0

  // --- sky: gradient and stars
  let skyline = () => {
    c.fillStyle = sky
    c.fillRect(0, 0, W, hz)
    let off = (a / TAU % 1 + 1) % 1 * 1024   // 1024 strip px per turn; the view is 71° = 203 of them
    for (let k = 0; k < 2; k++) c.drawImage(ST, (k * 1024 - off) * W / 203, 0, W * 1024 / 203, hz * .7)
  }

  // --- walls: one DDA per screen column. Unlike a flat-walled raycaster the
  // ray does not stop at the first wall: a building only hides what is behind
  // it up to its own roofline, so the march goes on, clipping each later face
  // to the skyline so far, until the fog swallows everything.
  // rf is 1 during the reflection pass: a face mirrors about its own base
  // line, not the horizon, which is one storey lower at that distance.
  let walls = (rf) => {
    BV = rf * D / 2
    for (let x = 0; x < W; x += D) {
      let cam = 2 * x / W - 1, rx = dx + px * cam, ry = dy + py * cam
      let gx = floor(P.x), gy = floor(P.y), ddx = abs(1 / rx), ddy = abs(1 / ry)
      let sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1
      let mx = (rx < 0 ? P.x - gx : gx + 1 - P.x) * ddx, my = (ry < 0 ? P.y - gy : gy + 1 - P.y) * ddy
      let side, d = 0, top = H, prev = cell(gx, gy), n = 0

      while (d < FAR && top > 0 && n++ < 150) {
        if (mx < my) { d = mx; mx += ddx; gx += sx; side = 0 }
        else { d = my; my += ddy; gy += sy; side = 1 }
        let b = cell(gx, gy)
        if (b && b != prev) {
          let h = H / max(.05, d), yt = hz - (b.n - .5 + rf) * h, yb = hz + (.5 - rf) * h
          if (yt < top) {
            let t = b.t || facade(b)
            // Where the ray met the wall, in texture columns. Two of the four
            // faces run right-to-left on screen and are flipped, so a sign
            // reads correctly whichever side of the shop you approach from.
            let w = side ? P.x + d * rx : P.y + d * ry, tx = (w - floor(w)) * S | 0
            if (side ? ry > 0 : rx < 0) tx = S - 1 - tx
            // Signs hang on about half the ground-floor cells of a shop.
            let sg = b.s && hash(gx, gy, 9) < .5
            col(t, tx, 0, S * (b.n - sg), x, yt, sg ? yb - h : yb, top)
            if (sg) col(t, tx, S * b.n, S, x, yb - h, yb, top)
            // Fog and a fake light direction in one translucent pass.
            c.fillStyle = 'rgba(10,6,22,' + min(1, (d / FAR) ** 1.4 + (side ? .2 : 0)) + ')'
            c.fillRect(x, yt, D, min(yb, top) - yt)
            top = yt
          }
        }
        prev = b
      }
    }
  }

  // --- reflections: the whole scene again, flipped about the horizon, at
  // half the column resolution because a wet street is not a mirror. It is
  // not clipped: the real sky and walls repaint everything above the horizon,
  // and a clip here dropped Chrome's canvas to a slow path — 60 fps to 12.
  c.save()
  c.translate(0, 2 * hz)
  c.scale(1, -1)
  D *= 2
  skyline()
  walls(1)
  D /= 2
  c.restore()

  // --- floor: one texel lookup per low-res pixel, walking the world along
  // each screen row. Street or sidewalk is decided by position in the block;
  // the dashed lane line is painted straight from world coordinates.
  let p = fd.data, rows = ceil((H - hz) / D)
  for (let y = 0, i = 0; y < rows; y++) {
    let rd = H / (2 * y * D + D), fa = min(1, rd / FAR), fb = 1 - fa
    let wx = P.x + (dx - px) * rd, wy = P.y + (dy - py) * rd, sx = 2 * px * rd / Wf, sy = 2 * py * rd / Wf
    for (let x = 0; x < Wf; x++, i += 4, wx += sx, wy += sy) {
      let u = (wx % 16 + 16) % 16, v = (wy % 16 + 16) % 16, t = u > 11 || v > 11 ? ASPH.d : PAVE.d
      let j = (wy * S & 63) * S + (wx * S & 63) << 2, r = t[j], g = t[j + 1], b = t[j + 2]
      if (abs(u - 14) < .06 && v % 1 < .5 || abs(v - 14) < .06 && u % 1 < .5) { r = 200; g = 170; b = 60 }
      p[i] = r * fb + 10 * fa
      p[i + 1] = g * fb + 6 * fa
      p[i + 2] = b * fb + 22 * fa
    }
  }
  fg.putImageData(fd, 0, 0)
  c.globalAlpha = .5
  c.drawImage(fc, 0, 0, Wf, rows, 0, hz, W, rows * D)
  c.globalAlpha = 1

  skyline()
  walls(0)

  // --- rain
  c.fillStyle = 'rgba(190,200,255,.22)'
  for (let i = 0; i < W / 9; i++) c.fillRect(rnd(W), rnd(H), 2, 10 + rnd(12))

  if (T < 8) {
    c.fillStyle = 'rgba(255,255,255,' + min(1, 8 - T) + ')'
    c.font = '14px monospace'
    c.textAlign = 'center'
    c.fillText('WASD to walk · drag to look · hold to walk', W / 2, H - 24)
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
  { id: 'doom', name: 'Doom-ish raycaster', mode: RUNTIME_HARNESS, code: DOOM },
  { id: 'city', name: 'Neon City — endless raycaster', mode: RUNTIME_HARNESS, code: CITY },
  { id: 'reaction', name: 'Reaction test (bare page)', mode: RUNTIME_BARE, code: BARE },
]

export const DEFAULT_EXAMPLE = EXAMPLES[0]
