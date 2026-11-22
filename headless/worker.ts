/**
 * One design operation per process. The host writes one JSON request to stdin and reads one JSON
 * reply from stdout, on the line that starts with the request's `nonce`; anything else a script
 * prints is not a reply. `.fig` bytes and images travel as base64.
 *
 * A script runs locked down, on top of the host's process limits (Node's permission model: no
 * file writes, child processes or workers; an empty environment; a time limit): the modules that
 * reach the network or other processes refuse to load, and the network globals are gone.
 */
import { registerHooks } from 'node:module'

import * as engine from './engine'

export type Request =
  | { op: 'new'; nonce: string; name?: string }
  | { op: 'outline'; nonce: string; fig: string }
  | { op: 'run'; nonce: string; fig: string; code: string; pageId?: string }
  | {
      op: 'import_html'
      nonce: string
      fig: string
      html: string
      name: string
      width: number
      height: number
      x?: number
      y?: number
      pageId?: string
    }
  | {
      op: 'render'
      nonce: string
      fig: string
      format: 'png' | 'svg'
      nodeId?: string
      pageId?: string
      scale?: number
    }
  | {
      op: 'migrate'
      nonce: string
      canvas: engine.CanvasFile
      text: Record<string, string>
      binary: Record<string, string>
    }

const write = process.stdout.write.bind(process.stdout)
const logs: string[] = []
let logBytes = 0
const LOG_LIMIT = 20_000

function keep(level: string, args: unknown[]) {
  if (logBytes > LOG_LIMIT) return
  const line = args
    .map((arg) => (typeof arg === 'string' ? arg : safeJSON(arg)))
    .join(' ')
    .slice(0, 2000)
  logBytes += line.length
  logs.push(level === 'log' ? line : `[${level}] ${line}`)
}
function safeJSON(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[level] = (...args: unknown[]) => keep(level, args)
}

const DENIED_MODULES = new Set([
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'child_process',
  'cluster',
  'worker_threads',
  'inspector',
  'module',
  'vm',
  'repl',
  'wasi',
  'v8',
  'process'
])

function refuse(what: string) {
  return () => {
    throw new Error(`${what} is not available to a design script.`)
  }
}

/** What a script cannot reach, on top of the process's own permissions. */
function lockDown() {
  registerHooks({
    resolve(specifier, context, next) {
      const name = specifier.replace(/^node:/, '').split('/')[0] ?? ''
      if (DENIED_MODULES.has(name)) throw new Error(`${specifier} is not available to a design script.`)
      return next(specifier, context)
    }
  })
  const deny = (target: object, keys: string[], label: string) => {
    for (const key of keys) {
      Object.defineProperty(target, key, { value: refuse(`${label}${key}`), configurable: false, writable: false })
    }
  }
  deny(globalThis, ['fetch', 'WebSocket', 'EventSource'], '')
  deny(
    process,
    ['binding', '_linkedBinding', 'dlopen', 'getBuiltinModule', 'kill', 'chdir', 'abort', 'setuid', 'setgid'],
    'process.'
  )
}

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))
const base64 = (data: Uint8Array) => Buffer.from(data).toString('base64')

async function handle(request: Request): Promise<Record<string, unknown>> {
  switch (request.op) {
    case 'new': {
      const graph = engine.newDocument(request.name)
      return { fig: base64(await engine.toFig(graph)) }
    }
    case 'outline': {
      const pages = engine.outline(await engine.openFig(bytes(request.fig)))
      return { pages, text: engine.outlineText(pages) }
    }
    case 'run': {
      const graph = await engine.openFig(bytes(request.fig))
      await engine.figmaFor(graph)
      lockDown()
      const { result, changed } = await engine.runScript(graph, request.code, request.pageId)
      const pages = engine.outline(graph)
      return { fig: base64(await engine.toFig(graph)), result, changed, pages }
    }
    case 'import_html': {
      const graph = await engine.openFig(bytes(request.fig))
      const nodeId = await engine.importHTML(graph, request.html, request)
      return { fig: base64(await engine.toFig(graph)), nodeId, pages: engine.outline(graph) }
    }
    case 'render': {
      const graph = await engine.openFig(bytes(request.fig))
      const target = request.nodeId ? { nodeId: request.nodeId } : { pageId: request.pageId }
      if (request.format === 'svg') return { svg: await engine.renderSVG(graph, target) }
      return { png: base64(await engine.renderPNG(graph, target, request.scale ?? 1)) }
    }
    case 'migrate': {
      const binary = Object.fromEntries(
        Object.entries(request.binary).map(([path, data]) => [path, bytes(data)])
      )
      const graph = await engine.migrateCanvas(request.canvas, { text: request.text, binary })
      return { fig: base64(await engine.toFig(graph)), pages: engine.outline(graph) }
    }
    default:
      throw new Error('Unknown design operation.')
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Request
  const nonce = request.nonce
  let reply: Record<string, unknown>
  try {
    reply = { ok: true, ...(await handle(request)), logs }
  } catch (error) {
    reply = { ok: false, error: errorText(error), logs }
  }
  write(`${nonce}${JSON.stringify(reply)}\n`, () => process.exit(0))
}

void main()
