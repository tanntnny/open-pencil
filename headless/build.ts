/**
 * Builds the headless design engine as one Node module, `dist-headless/worker.mjs`, with the
 * WebAssembly and fonts it loads beside it. Run after the packages are built:
 * `bun run build:headless`. The packages find their files through their package names, which a
 * single module does not have, so those lookups are pointed at the copies next to it.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { BunPlugin } from 'bun'

const root = resolve(import.meta.dir, '..')
const out = join(root, 'dist-headless')
const pkg = (name: string) => join(root, 'packages', name)

/** Each `import.meta.resolve` of a package file, and the file next to the module it becomes. */
const RESOLVED: Record<string, string> = {
  '@open-pencil/canvaskit': './canvaskit/canvaskit.js',
  '@open-pencil/core/package.json': './core/package.json',
  '@open-pencil/html-engine/wasm/html-engine.wasm': './html-engine/html-engine.wasm'
}

const localFiles: BunPlugin = {
  name: 'headless-local-files',
  setup(build) {
    // Shader sources the canvas imports as text, as Vite's `?raw` does.
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, '')),
      namespace: 'raw-text'
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
      loader: 'js'
    }))
    // css-tree reads its JSON data through `createRequire`, which a single module cannot follow.
    build.onLoad({ filter: /[\\/]css-tree[\\/]lib[\\/].*\.js$/ }, async (args) => {
      let text = await Bun.file(args.path).text()
      const imports: string[] = []
      text = text.replace(/require\((['"])([^'"]+\.json)\1\)/g, (_, _quote, file: string) => {
        imports.push(`import __json${imports.length} from ${JSON.stringify(file)} with { type: 'json' };`)
        return `__json${imports.length - 1}`
      })
      return { contents: `${imports.join('\n')}\n${text}`, loader: 'js' }
    })
    build.onLoad({ filter: /[\\/]packages[\\/][^\\/]+[\\/](src|dist)[\\/].*\.[jt]s$/ }, async (args) => {
      let text = await Bun.file(args.path).text()
      for (const [name, file] of Object.entries(RESOLVED)) {
        const local = `new URL(${JSON.stringify(file)}, import.meta.url).href`
        text = text.replaceAll(`import.meta.resolve("${name}")`, local)
        text = text.replaceAll(`import.meta.resolve('${name}')`, local)
      }
      return { contents: text, loader: args.path.endsWith('.ts') ? 'ts' : 'js' }
    })
  }
}

await rm(out, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [join(root, 'headless/worker.ts')],
  outdir: out,
  naming: 'worker.mjs',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'none',
  minify: { syntax: true, whitespace: true, identifiers: false },
  plugins: [localFiles]
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await mkdir(join(out, 'canvaskit'), { recursive: true })
await cp(join(pkg('canvaskit'), 'dist/canvaskit.wasm'), join(out, 'canvaskit/canvaskit.wasm'))
await cp(join(pkg('canvaskit'), 'LICENSE'), join(out, 'canvaskit/LICENSE'))
await cp(join(pkg('canvaskit'), 'dist/THIRD-PARTY-NOTICES.md'), join(out, 'canvaskit/THIRD-PARTY-NOTICES.md'))
await cp(join(pkg('taffy'), 'dist/taffy.wasm'), join(out, 'taffy.wasm'))
// harfbuzzjs looks for its module next to the one that loads it.
const harfbuzz = dirname(Bun.resolveSync('harfbuzzjs/package.json', pkg('core')))
await cp(join(harfbuzz, 'dist/harfbuzz.wasm'), join(out, 'harfbuzz.wasm'))
await mkdir(join(out, 'html-engine'), { recursive: true })
await cp(
  join(root, 'node_modules/@open-pencil/html-engine/wasm/html-engine.wasm'),
  join(out, 'html-engine/html-engine.wasm')
)
await mkdir(join(out, 'core'), { recursive: true })
await writeFile(join(out, 'core/package.json'), '{ "name": "@open-pencil/core", "private": true }\n')
await cp(join(pkg('core'), 'assets'), join(out, 'core/assets'), { recursive: true })
await cp(join(root, 'LICENSE'), join(out, 'LICENSE'))
await cp(join(root, 'LICENSES'), join(out, 'LICENSES'), { recursive: true })
await cp(join(harfbuzz, 'LICENSE'), join(out, 'LICENSES/harfbuzzjs.txt'))

console.log(`Built ${out}`)
