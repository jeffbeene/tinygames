// Serves dist/ under the rules in public/_headers.
//
// Cloudflare Pages applies that file at the edge, which means `npm run dev`
// never sees it and a broken CSP would only surface in production. This is the
// smallest thing that makes the policy testable locally: same files, same
// headers, so `check:headers` exercises what actually ships.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  // Anything but application/wasm fails instantiateStreaming, and nosniff
  // removes the browser's fallback guess.
  '.wasm': 'application/wasm',
}

/**
 * Parses Cloudflare's `_headers` format: a path pattern at column 0, followed
 * by indented `Name: value` lines. Only the `*` wildcard is supported, which is
 * all this project uses.
 */
export async function parseHeaders(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return []
  }

  const rules = []
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] })
      continue
    }
    const at = line.indexOf(':')
    if (at === -1 || !rules.length) continue
    rules[rules.length - 1].headers.push([
      line.slice(0, at).trim(),
      line.slice(at + 1).trim(),
    ])
  }
  return rules
}

const matches = (pattern, pathname) => {
  const re = new RegExp(
    '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
  )
  return re.test(pathname)
}

export async function serve({ port = 0, headersFile } = {}) {
  const rules = await parseHeaders(
    headersFile ?? fileURLToPath(new URL('../public/_headers', import.meta.url)),
  )

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)

    // Pages serves directory indexes; /play/ must resolve to /play/index.html
    // or the whole second entry point is untestable.
    let file = path.join(DIST, pathname)
    try {
      if ((await stat(file)).isDirectory()) {
        pathname = path.posix.join(pathname, 'index.html')
        file = path.join(DIST, pathname)
      }
    } catch {
      /* missing; handled below */
    }

    // Contain path traversal: a resolved path must stay under dist/.
    if (!path.resolve(file).startsWith(path.resolve(DIST))) {
      res.writeHead(403).end('forbidden')
      return
    }

    let body
    try {
      body = await readFile(file)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }

    for (const rule of rules) {
      if (!matches(rule.pattern, pathname)) continue
      for (const [name, value] of rule.headers) res.setHeader(name, value)
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream')
    res.writeHead(200).end(body)
  })

  await new Promise((resolve) => server.listen(port, resolve))
  const origin = `http://localhost:${server.address().port}`
  return { server, origin, close: () => new Promise((r) => server.close(r)) }
}

// Standalone: `node scripts/serve-dist.mjs`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { origin } = await serve({ port: Number(process.env.PORT) || 5180 })
  console.log(`serving dist/ with _headers at ${origin}`)
}
