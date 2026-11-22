import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Plugin } from 'vite'

/** This fork's release of the editor for an upstream version; raise it with each change a host takes. */
const RELEASE = 2

/**
 * Makes the embed's output folder an npm package, `@xingular/open-pencil-embed`, that a host
 * installs and serves as it is: its manifest, the declarations of `mountDesignEditor` and its
 * options, a README, and the licences of what it bundles.
 */
export function embedPackagePlugin(root: string): Plugin {
  return {
    name: 'open-pencil-embed-package',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir
      if (!out) return
      const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
      const manifest = {
        name: '@xingular/open-pencil-embed',
        version: `${version}-xingular.${RELEASE}`,
        description: 'The OpenPencil editor, embeddable in another application page',
        license: 'MIT',
        type: 'module',
        types: './embed.d.ts',
        exports: {
          '.': { types: './embed.d.ts', default: './embed.js' },
          './embed.js': './embed.js',
          './embed.css': './embed.css',
          './package.json': './package.json'
        },
        repository: { type: 'git', url: 'git+https://github.com/tanntnny/open-pencil.git', directory: 'src/embed' }
      }
      writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      const types = readFileSync(join(root, 'src/embed/types.ts'), 'utf8')
      writeFileSync(
        join(out, 'embed.d.ts'),
        `${types}
/** The class every embed style is scoped under, on the editor's element and its portal. */
export declare const EMBED_SCOPE = 'xop'

/**
 * Mounts the editor into \`element\` with one design. A page shows one embedded editor at a time;
 * \`destroy\` the last before mounting the next. Link \`embed.css\` first.
 */
export declare function mountDesignEditor(element: HTMLElement, options: DesignEditorOptions): DesignEditorHandle
`
      )
      cpSync(join(root, 'src/embed/README.md'), join(out, 'README.md'))
      cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
      cpSync(join(root, 'LICENSES'), join(out, 'LICENSES'), { recursive: true })
    }
  }
}
