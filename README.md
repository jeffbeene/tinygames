# tinygames

An in-browser IDE for JavaScript games small enough to fit **entirely inside a
QR code**. No server, no database, no game IDs — the QR code *is* the game.

Two pages:

- **`/`** — Create. Editor on the left, live sandboxed preview on the right, QR
  code and byte budget in the corner. Every keystroke is minified (Terser),
  compressed (Brotli, quality 11), encoded, and re-rendered as a QR code.
- **`/play/#<payload>`** — Play. Where a scanned code lands. Decodes the
  fragment, then holds it behind a one-tap welcome gate — the code is a
  stranger's, so nothing from it paints until a visitor asks — and runs the
  game edge to edge.

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # -> dist/  (static; deploy anywhere)

npm run check:pipeline   # minify -> compress -> encode -> QR, sizes and round-trips
npm run check:e2e        # drives a real browser; decodes the QR image with jsQR
```

## The budget

A version-40 QR code at error-correction level L holds **4296 alphanumeric
characters**. After the URL prefix, that leaves roughly **2834 bytes** of Brotli
output — about **35–40 KB of readable JavaScript**, or ~18 copies of the bundled
Snake example. The examples land between 9% and 70% of budget, except the
Neon City raycaster, which fills it on purpose: an endless procedural city at
99.5% of a v40 code.

The budget bar is marked with the points where the symbol gets harder to scan:

| Payload | QR version | Reads as |
| --- | --- | --- |
| ≤ 475 B | ≤ v15 | scans instantly |
| ≤ 1106 B | ≤ v24 | scans easily |
| ≤ 1864 B | ≤ v32 | needs a steady camera |
| ≤ 2834 B | ≤ v40 | hard from a phone screen |

Those thresholds are measured at runtime for the URL prefix in use, not
hard-coded — a shorter domain genuinely buys you a little more room.

> **A v40 symbol is 177×177 modules.** iOS Camera and Google Lens handle it from
> a decent-sized screen, but many in-app scanners top out around v25–v30, and a
> business-card-sized print is hopeless. Keep games in the green if you intend to
> print them, and use the PNG export (1600 px) rather than a screenshot.

## How a game is encoded

```
source ──Terser──▶ minified ──Brotli q11──▶ bytes ──┐
                                                     ├─▶ [1-byte header] ──Base42──▶ fragment
                                        runtime mode ┘
```

**Base42** is the interesting part. QR's alphanumeric mode packs two characters
into 11 bits (5.5 bits/char) but accepts only 45 symbols:
`0-9 A-Z space $ % * + - . / :`. Three are unusable in a URL — `%` starts an
escape, space must be encoded, and `+` is decoded as a space by form decoders —
leaving 42. Since `42³ = 74088 ≥ 65536`, two bytes still pack into three
characters: the same density as RFC 9285 Base45, with none of the URL hazards.

That costs 1.5 characters per byte. Base64 in QR *byte* mode would carry only
~2214 bytes instead of 2834, and percent-encoded binary far less.

The URL itself contains `#`, which alphanumeric mode cannot represent, so each
symbol uses **two segments**: byte mode for the prefix, alphanumeric for the
payload. Mixing modes in one symbol is standard and universally supported; the
byte prefix costs ~44 characters, about 1% of the budget.

The payload rides in the **fragment**, so it is never sent to a server — no
414s, no access logs, no CDN caches, and `location.hash` is not form-decoded.

### QR version and error correction

The smallest version that fits is chosen, then the strongest error correction
that fits *at that same version* (standard "boost ECL"). Module count, not error
correction, is what decides whether a phone can read a code, so size is
minimised first and unconditionally.

In practice this means the level is almost always **L** — a minimum-version
symbol is tightly packed by definition, so there is rarely slack to upgrade into.
The tempting alternative (spend leftover budget on stronger error correction,
allowing a larger version) was implemented and rejected: it makes symbol size
non-monotonic in payload size, so *deleting* code could make your QR bigger.

## Runtimes

Every game runs in an iframe sandboxed **without** `allow-same-origin`, so it
gets an opaque origin and cannot reach the host page, its storage, or its
cookies. Code arriving from a URL is untrusted by definition.

### Canvas harness (default)

A full-bleed canvas, DPR handling, resize, an input map and the frame loop are
provided and cost the author nothing:

| | |
| --- | --- |
| `c` | 2D context, sized to the viewport |
| `W`, `H` | canvas size in CSS pixels |
| `T`, `dt`, `F` | seconds since start, seconds since last frame, frame count |
| `K` | keys currently held — `K.ArrowLeft`, `K.a`, `K.Space` |
| `M` | pointer — `M.x`, `M.y`, `M.down` |
| `snd(freq, secs, type, gain)` | one short tone |
| `clear(color)`, `rnd(n)` | fill or clear the canvas; random float |
| `sin cos tan atan2 abs min max floor ceil round sqrt hypot pow sign random PI TAU` | `Math` without the prefix |

Assign `setup()` to run once, `draw()` to run every frame, and `resized()` on
resize. These three names are pinned against Terser's toplevel mangler.

Keys and taps are **latched for one frame**: a press released between two frames
is still visible to the next `draw()`, so fast taps are never dropped.

**Read `W`/`H` inside `setup()`, not at the top level.** Top-level code runs
while the document is still parsing, before the canvas necessarily has a size.
`setup()` is deliberately deferred until the canvas has real dimensions, and
`resized()` fires on every subsequent change (driven by a `ResizeObserver`, so a
frame resized by the parent's layout is caught too, not just window resizes).

```js
let x
setup = () => { x = W / 2 }     // correct
// let x = W / 2                // wrong: W may not be known yet
```

### Bare page

An empty document and nothing else — no canvas, no loop, no globals. The right
choice when a game is DOM- or CSS-shaped. Costs ~150–250 bytes of boilerplate.

The runtime is recorded in the payload header, so Play boots the correct shell
before looking at the code.

## Notes

- **Remixing is lossy.** A QR code carries only the minified build, so opening a
  scanned game in the editor gives you mangled names and no comments. The editor
  says so when it happens.
- The preview runs your **source** by default; switch to *run shipped* to
  execute the exact minified code the QR carries.
- Brotli needs WebAssembly — browsers expose gzip/deflate via `CompressionStream`
  but not `br`. Create loads the full `brotli-wasm`; Play loads decompress-only
  `brotli-dec-wasm` (208 KB) so the scan-to-play path stays lean.
- Drafts are kept in `localStorage`, as is the capacity calibration (which costs
  ~500 ms of QR building and depends only on the URL prefix).
