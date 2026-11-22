import { shallowRef, watch, type WatchStopHandle } from 'vue'

import { EDITOR_TOOLS, type Tool } from '@open-pencil/core'

import { getTabForStore, closeTab, createDocumentTab, openFileInNewTab, type Tab } from '@/app/tabs'
import { figFile } from '@/app/tabs/open/fig'
import type { EditorStore } from '@/app/editor/session'

import type { DesignEditorNode, DesignEditorOptions } from './types'

const DEFAULT_SAVE_DELAY = 800

/**
 * The design tools, without Comment, which the host owns, or the board tools (sticky note, shape
 * with text, connector), which a design's toolbar keeps hidden as Figma's does.
 */
const LEFT_OUT: readonly Tool[] = ['COMMENT', 'STICKY', 'SHAPE_WITH_TEXT', 'CONNECTOR']
const EMBED_TOOLS: ReadonlySet<Tool> = new Set(
  EDITOR_TOOLS.flatMap((tool) => tool.flyout ?? [tool.key]).filter((tool) => !LEFT_OUT.includes(tool))
)

/**
 * The one design an embed shows: opened from the host's bytes, and saved back through
 * `onChange` a short while after each edit, by the editor's own tracked save, so an edit made
 * while a save is being written is saved by the next one.
 */
export function createEmbedSession(options: DesignEditorOptions) {
  const tab = shallowRef<Tab | null>(null)
  let stops: WatchStopHandle[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving: Promise<void> | null = null
  let disposed = false

  function stopWatching() {
    for (const stop of stops) stop()
    stops = []
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function save(store: EditorStore) {
    if (!options.onChange || !store.hasUnsavedChanges()) return
    await store.saveFigFileCopy(async (bytes) => {
      await options.onChange?.(bytes)
    })
  }

  function scheduleSave(store: EditorStore) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flushStore(store)
    }, options.saveDelay ?? DEFAULT_SAVE_DELAY)
  }

  async function flushStore(store: EditorStore) {
    // One save at a time; an edit during it is picked up by the save that follows.
    while (saving) await saving
    if (disposed && !options.onChange) return
    saving = save(store)
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        saving = null
      })
    await saving
  }

  function watchStore(store: EditorStore) {
    stopWatching()
    stops.push(
      watch(
        () => store.hasUnsavedChanges(),
        (dirty) => {
          if (dirty) scheduleSave(store)
        }
      ),
      watch(
        () => store.selectedNodes.value,
        (nodes) => {
          const selection: DesignEditorNode[] = nodes.map((node) => ({
            id: node.id,
            name: node.name,
            type: node.type
          }))
          options.onSelection?.(selection)
        }
      )
    )
  }

  async function open(bytes: Uint8Array | null, name = options.name ?? 'Design') {
    stopWatching()
    const previous = tab.value
    let next: Tab | undefined
    if (bytes) {
      const store = await openFileInNewTab(figFile(bytes, name))
      next = getTabForStore(store)
    } else {
      next = createDocumentTab('design')
      next.store.renameDocument(name)
      next.store.markDocumentSaved()
    }
    if (!next) throw new Error('The design did not open.')
    // Comments belong to the host, which anchors them to the layers the person selects.
    next.store.setHostRestrictions({ tools: EMBED_TOOLS })
    tab.value = next
    // The host has every save by now, so the old design closes without asking.
    if (previous && previous !== next) await closeTab(previous.id, 'discard')
    watchStore(next.store)
  }

  return {
    tab,
    open,
    async flush() {
      const store = tab.value?.store
      if (!store) return
      if (timer) clearTimeout(timer)
      timer = null
      await flushStore(store)
    },
    dispose() {
      disposed = true
      stopWatching()
    }
  }
}

export type EmbedSession = ReturnType<typeof createEmbedSession>
