/**
 * Checks the built engine (`dist-headless/`) the way a host runs it: one locked-down process per
 * operation, under Node's permission model, reading only its own folder. Run with the Node the
 * host uses: `node headless/smoke.mjs`, or Electron's with `ELECTRON_RUN_AS_NODE=1`.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../dist-headless', import.meta.url))

function call(request, timeout = 60_000) {
  const nonce = `${randomUUID()}:`
  return new Promise((resolve) => {
    const env = process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: '1' } : {}
    const args = ['--permission', `--allow-fs-read=${dir}`, '--max-old-space-size=1536', `${dir}/worker.mjs`]
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('close', () => {
      clearTimeout(timer)
      const line = out.split('\n').find((candidate) => candidate.startsWith(nonce))
      resolve(line ? JSON.parse(line.slice(nonce.length)) : null)
    })
    child.stdin.end(JSON.stringify({ ...request, nonce }))
  })
}

const ok = (reply) => {
  assert.ok(reply, 'no reply')
  assert.equal(reply.ok, true, reply.error)
  return reply
}

let { fig } = ok(await call({ op: 'new', name: 'Screens' }))
const run = ok(
  await call({
    op: 'run',
    fig,
    code: `const f = figma.createFrame(); f.name = 'Card'; f.resize(320, 200); console.log('made'); return { id: f.id }`
  })
)
assert.deepEqual(run.logs, ['made'])
assert.equal(typeof run.result.id, 'string')
fig = run.fig
const imported = ok(
  await call({
    op: 'import_html',
    fig,
    html: '<!doctype html><body><h1>Pricing</h1><button>Buy</button></body>',
    name: 'Pricing',
    width: 390,
    height: 600
  })
)
const frame = imported.pages[0].nodes.find((node) => node.id === imported.nodeId)
assert.equal(frame.name, 'Pricing')
assert.equal(frame.w, 390)
fig = imported.fig
const blank = ok(await call({ op: 'import_html', fig, html: '<!doctype html><body></body>', name: 'Blank', width: 390, height: 844 }))
assert.deepEqual(
  (({ name, type, w, h }) => ({ name, type, w, h }))(blank.pages[0].nodes.find((node) => node.id === blank.nodeId)),
  { name: 'Blank', type: 'FRAME', w: 390, h: 844 }
)
const outline = ok(await call({ op: 'outline', fig }))
assert.match(outline.text, /frame .* "Card"/)
assert.match(outline.text, /"Pricing"/)
const png = ok(await call({ op: 'render', fig, format: 'png', nodeId: imported.nodeId }))
assert.equal(Buffer.from(png.png, 'base64').subarray(1, 4).toString(), 'PNG')
const svg = ok(await call({ op: 'render', fig, format: 'svg' }))
assert.match(svg.svg, /<svg[\s>]/)
const migrated = ok(
  await call({
    op: 'migrate',
    canvas: {
      version: 1,
      pages: [
        {
          id: 'p1',
          name: 'Flow',
          items: [
            { id: 't', kind: 'text', x: 0, y: -80, w: 300, h: 40, text: 'Login flow' },
            { id: 'f', kind: 'frame', x: 0, y: 0, w: 390, h: 500, name: 'Login', file: 'frames/f.html' },
            { id: 'n', kind: 'note', x: 480, y: 0, w: 200, h: 120, text: 'Check errors' },
            { id: 's', kind: 'shape', x: 480, y: 160, w: 120, h: 80, style: { shape: 'ellipse' } },
            { id: 'd', kind: 'draw', x: 480, y: 280, w: 100, h: 60, points: [[0, 0], [50, 60], [100, 0]] }
          ]
        }
      ]
    },
    text: { 'frames/f.html': '<!doctype html><body><h2>Welcome</h2></body>' },
    binary: {}
  })
)
assert.deepEqual(
  migrated.pages[0].nodes.map((node) => node.type),
  ['TEXT', 'FRAME', 'FRAME', 'ELLIPSE', 'FRAME']
)

const refused = {
  fetch: `return await fetch('https://example.com')`,
  net: `return typeof (await import('node:net')).connect`,
  http: `return typeof (await import('http')).get`,
  childProcess: `return typeof (await import('node:child_process')).exec`,
  builtin: `return typeof process.getBuiltinModule('node:net')`,
  escapedBuiltin: `return typeof figma.constructor.constructor('return process')().getBuiltinModule('node:net')`,
  binding: `return typeof process.binding('tcp_wrap')`,
  write: `(await import('node:fs')).writeFileSync('/private/tmp/xop-probe', 'x')`,
  read: `return (await import('node:fs')).readdirSync('/')`
}
for (const [name, code] of Object.entries(refused)) {
  const reply = await call({ op: 'run', fig, code })
  assert.equal(reply?.ok, false, `${name} ran`)
}
const env = ok(await call({ op: 'run', fig, code: 'return Object.keys(process.env)' }))
assert.ok(env.result.every((key) => key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('__CF')), env.result.join())
const forged = ok(await call({ op: 'run', fig, code: `process.stdout.write('{"ok":true,"fig":""}\\n'); return 1` }))
assert.equal(forged.result, 1)
assert.equal(await call({ op: 'run', fig, code: 'while (true) {}' }, 4000), null)

console.log(`headless engine ok (${process.version})`)
