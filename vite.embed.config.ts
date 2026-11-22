import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

import { openPencil } from '@open-pencil/core/node/vite'

import packageJson from './package.json'
import { viteBuildTarget } from './src/app/shell/support/baseline'
import { createOpenPencilAliases } from './vite/aliases'
import { embedCssPlugin } from './vite/embed-css'
import { aiIconCollection } from './vite/icons'
import { inlineScriptPlugin } from './vite/inline-script'
import { rawMarkdownPlugin } from './vite/raw-markdown'

/**
 * The editor as another application embeds it (`src/embed/`): one module, `embed.js`, exporting
 * `mountDesignEditor`, beside `embed.css` and the chunks, WebAssembly and fonts it loads by
 * relative address, so the host serves the folder as it is from wherever it likes.
 * `embed.html` is a page to try it on (`bun run dev:embed`).
 */
export default defineConfig(({ command }) => ({
  resolve: {
    alias: [
      // What the app has and an embed leaves to its host: updating itself, the AI chat, and
      // collaboration's panel and room overlay.
      {
        find: /^virtual:pwa-register\/vue$/,
        replacement: resolve(__dirname, 'src/embed/stubs/pwa-register.ts')
      },
      ...[
        'chat/ChatPanel.vue',
        'chat/FloatingChat.vue',
        'collab-panel/CollabPanel.vue',
        'collab-room/ActiveRoomOverlay.vue'
      ].map((component) => ({
        find: new RegExp(`^@/components/${component.replaceAll('.', '\\.')}$`),
        replacement: resolve(__dirname, 'src/embed/stubs/Empty.vue')
      })),
      ...createOpenPencilAliases(__dirname, { cloud: false })
    ]
  },
  define: {
    __OPENPENCIL_APP_VERSION__: JSON.stringify(packageJson.version),
    __OPENPENCIL_CLOUD_SITE__: 'false',
    __OPENPENCIL_EMBED__: 'true',
    __OPENPENCIL_DONATION_URL__: 'null',
    __OPENPENCIL_OFFICIAL_CLOUD_URL__: 'null',
    __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: 'null',
    __OPENPENCIL_LOCAL_AUTOMATION_URL__: JSON.stringify(''),
    __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: JSON.stringify('')
  },
  plugins: [
    rawMarkdownPlugin(),
    inlineScriptPlugin(),
    tailwindcss(),
    embedCssPlugin(),
    openPencil({ inject: false }),
    Icons({ compiler: 'vue3', customCollections: { ai: aiIconCollection() } }),
    Components({ resolvers: [IconsResolver({ prefix: 'icon', customCollections: ['ai'] })] }),
    vue()
  ],
  clearScreen: false,
  cacheDir: 'node_modules/.vite-embed',
  publicDir: false,
  base: './',
  server: { port: 1430, strictPort: true },
  build: {
    target: viteBuildTarget(),
    outDir: 'dist-embed',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false,
    rolldownOptions: {
      input: command === 'build' ? { embed: resolve(__dirname, 'src/embed/index.ts') } : undefined,
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'embed.css'
            : 'assets/[name]-[hash][extname]'
      }
    }
  }
}))
