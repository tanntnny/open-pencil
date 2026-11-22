import type { Plugin } from 'vite'

const TAURI_CHECK = /'__TAURI_INTERNALS__' in (?:globalThis\.)?window/g

/**
 * An embedded editor is never the Tauri desktop app, whatever its host's page holds: a host that
 * offers its own `__TAURI_INTERNALS__` (an Electron app with a Tauri-shaped bridge, say) would
 * otherwise send the editor down the desktop paths, to APIs the host does not have. The app's and
 * the core's checks for it read as false in the embed build.
 */
export function embedNotTauriPlugin(): Plugin {
  return {
    name: 'open-pencil-embed-not-tauri',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/node_modules/') || !code.includes('__TAURI_INTERNALS__')) return null
      const next = code.replace(TAURI_CHECK, 'false')
      return next === code ? null : { code: next, map: null }
    }
  }
}
