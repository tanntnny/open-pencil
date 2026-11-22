import './zod-jitless'

import { createHead } from '@unhead/vue/client'
import { createApp, h, watch } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { RefusedEditError } from '@open-pencil/core'
import { createOpenOverlaysPlugin } from '@open-pencil/vue/lifecycle/overlays'
import { createRetainedScopePlugin } from '@open-pencil/vue/lifecycle/retention'

import { setActiveEditorStore } from '@/app/editor/active-store'
import { preloadCanvasKit } from '@/app/editor/canvas/canvaskit'
import { preloadFonts } from '@/app/editor/fonts'
import { registerInterfaceFont } from '@/app/editor/fonts/interface'
import { setAppTheme, setThemeElements } from '@/app/shell/theme'

import './embed.css'
import EmbedRoot from './EmbedRoot.vue'
import { createEmbedSession } from './session'
import type { DesignEditorHandle, DesignEditorOptions, DesignEditorTheme } from './types'

export type {
  DesignEditorHandle,
  DesignEditorNode,
  DesignEditorOptions,
  DesignEditorTheme
} from './types'

/** The class every embed style is scoped under, on the editor's element and its portal. */
export const EMBED_SCOPE = 'xop'

let mounted = false

/**
 * Mounts the editor into `element` with one design. The editor keeps its tabs in module state, so
 * a page shows one embedded editor at a time; `destroy` the last before mounting the next.
 */
export function mountDesignEditor(
  element: HTMLElement,
  options: DesignEditorOptions
): DesignEditorHandle {
  if (mounted) throw new Error('A design editor is already mounted on this page.')
  mounted = true
  registerInterfaceFont()
  preloadCanvasKit()
  preloadFonts()

  let editable = options.editable ?? true

  // Menus, popovers and dialogs portal here, inside the style scope, above the host's own content.
  const portal = document.createElement('div')
  portal.className = `${EMBED_SCOPE} ${EMBED_SCOPE}-portal`
  document.body.append(portal)
  const root = document.createElement('div')
  root.className = `${EMBED_SCOPE} ${EMBED_SCOPE}-root`
  element.append(root)

  // The editor's theme goes on its own elements, never the host's page: before anything mounts,
  // as the workspace applies the theme as soon as it does.
  setThemeElements([root, portal])
  const setTheme = (next: DesignEditorTheme) => setAppTheme(next)
  setTheme(options.theme ?? 'dark')

  const session = createEmbedSession(options)
  // The editor's own links and menus expect a router; the embed has one page.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }]
  })
  const app = createApp({ render: () => h(EmbedRoot, { session, portal, root }) })
  app.use(router).use(createHead()).use(createRetainedScopePlugin()).use(createOpenOverlaysPlugin())
  app.config.errorHandler = (error) => {
    // An edit the document refuses, as a read-only one does, does nothing, as in the app.
    if (error instanceof RefusedEditError) return
    options.onError?.(error)
  }

  // Shortcuts, menus and the clipboard act on the shown design, from the moment it shows.
  const stopActive = watch(session.tab, (tab) => {
    if (tab) setActiveEditorStore(tab.store)
  })
  // Editing is allowed or not once the design has opened: changing it while the page is still
  // being prepared would restart the preparation.
  const stopEditable = watch(session.tab, (tab) => {
    if (tab && !editable) tab.store.setReadOnly(true)
  })
  app.mount(root)

  void session.open(options.bytes, options.name).catch((error: unknown) => options.onError?.(error))

  return {
    async load(bytes, name) {
      await session.flush()
      await session.open(bytes, name)
    },
    setTheme,
    setEditable(next) {
      editable = next
      session.tab.value?.store.setReadOnly(!next)
    },
    flush: () => session.flush(),
    destroy() {
      stopActive()
      stopEditable()
      session.dispose()
      app.unmount()
      root.remove()
      portal.remove()
      mounted = false
    }
  }
}
