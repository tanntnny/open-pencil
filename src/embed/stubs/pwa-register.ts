import { ref } from 'vue'

/**
 * The embed's stand-in for `virtual:pwa-register/vue`: an embedded editor is the host's to update,
 * so it registers no service worker and never offers a new version.
 */
export function useRegisterSW() {
  return {
    needRefresh: ref(false),
    offlineReady: ref(false),
    updateServiceWorker: async () => undefined
  }
}
