# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An in-browser IDE for JavaScript games small enough to fit entirely inside a QR
code. There is no server and no game storage — the QR code *is* the game. Two
pages: Create (`/`) and Play (`/play/#<payload>`).

`README.md` covers the encoding maths and the author-facing runtime API. Read it
before changing anything in `src/shared/`.

## Commands

```bash
npm run dev              # vite dev server
npm run build            # static build -> dist/
npm run check:pipeline   # node-only: minify -> compress -> encode -> QR, sizes + round-trips
npm run check:e2e        # drives a browser end-to-end (dev server must be running)

HEADED=1 npm run check:e2e            # real Chrome instead of headless — see below
BASE=http://localhost:5200 npm run check:e2e   # point the suite at another origin
```

`check:e2e` is the real safety net. It generates a QR, **decodes the rendered
image with jsQR**, and loads the decoded URL on Play to confirm the game runs.
There is no unit-test runner and no linter configured.

**Run the e2e suite headed before trusting a layout or sizing change.** Headless
Chromium forces layout differently from a real browser and has already hidden one
production bug (games starting against a 0×0 canvas) that only reproduced with
`HEADED=1`. Individual checks aren't separately runnable; the suite is one script.

## Architecture

### The pipeline

`source ──Terser──▶ minified ──Brotli q11──▶ bytes ──▶ [1-byte header] ──Base42──▶ URL fragment`

Everything expensive runs in `src/create/compile.worker.js`, which owns Terser,
Brotli **and** QR construction, and answers three ops (`compile`, `decode`,
`calibrate`). The main thread only paints a module bitmap the worker hands back.

**`src/shared/qr.js` must never be imported by main-thread code** — it pulls in
`qrcode-generator`. That is why QR concerns are split three ways:

- `qr.js` — the encoder. Worker only.
- `qr-meta.js` — tiers, ECC names, version maths. Dependency-free, shared.
- `qr-render.js` — bitmap → canvas. Main thread only.

### Running untrusted game code

`src/shared/frame.js` builds the sandboxed document both the editor preview and
Play use, so what you test is what a scanner gets. Two invariants:

- **Always mount via `mountGameFrame()`, never `createGameFrame()` + append.**
  A `srcdoc` document starts parsing the instant `srcdoc` is assigned; if the
  iframe has not been laid out, the child's viewport is 0×0 and anything sizing
  itself from `W`/`H` or `innerWidth` silently builds against zeroes.
- The sandbox deliberately omits `allow-same-origin`, so games get an opaque
  origin and `localStorage` throws inside them. Don't "fix" this.

Game code runs as a **classic, non-strict, global-scope** script, because the
API depends on implicit globals (`draw = () => {}`). It can never become an ES
module — modules are strict mode and that assignment would throw.

### The harness

`src/shared/harness-runtime.js` is imported with `?raw` and injected verbatim, so
it must stay plain script: no imports, no exports, no bundler syntax.

`draw`, `setup` and `resized` are listed in `RUNTIME_ENTRY_POINTS` in the worker
so Terser's toplevel mangler and dead-code elimination leave them alone.
**Adding a new entry point means adding it there too**, or games using it break
only after minification — which the source preview won't show.

Sizing is driven by a `ResizeObserver`, and `setup()` is deferred until the
canvas has real dimensions. Input is latched for one frame so a tap pressed and
released between frames still reaches `draw()`.

### Payload compatibility

`src/shared/format.js` defines a 1-byte header (`FORMAT_VERSION` + runtime
mode). Existing QR codes are printed and out in the world, so changing the
format or the Base42 alphabet **breaks every code already in circulation**. Bump
`FORMAT_VERSION` and keep the old path readable rather than editing in place.

## Conventions

- Vite MPA: `index.html` plus `play/index.html`, which builds to `dist/play/`
  so `/play/` works on a plain static host with no rewrite rules.
- Plain JS, no framework, no TypeScript. ESM everywhere, two-space indent, no
  semicolons.
- Comments explain *why*, especially where a simpler-looking approach was tried
  and rejected (see the ECC policy in `qr.js`). Preserve that reasoning.
- Capacity is measured at runtime for the current URL prefix and cached in
  `localStorage` — never hard-code byte budgets.
