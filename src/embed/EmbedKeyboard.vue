<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { ref } from 'vue'

import { useEditorKeyboard } from '@open-pencil/vue/editor/keyboard'

import { useEditorStore } from '@/app/editor/active-store'
import { bindEditorClipboard } from '@/app/shell/keyboard/clipboard'

/**
 * The editor's keys and clipboard, while the person is using the editor: from a press or focus
 * inside its element or a menu it opened, until one lands elsewhere in the host's page. The
 * host's own keys and clipboard work as usual everywhere else. The app's own shortcuts (files,
 * tabs, settings) stay out: the host has its own.
 */
const { scopes } = defineProps<{ scopes: HTMLElement[] }>()

const engaged = ref(false)
function engage(event: Event) {
  const target = event.target
  engaged.value = target instanceof Node && scopes.some((scope) => scope.contains(target))
}
useEventListener(document, 'pointerdown', engage, { capture: true })
useEventListener(document, 'focusin', engage, { capture: true })

useEditorKeyboard({ active: engaged })
bindEditorClipboard(useEditorStore(), () => engaged.value)
</script>

<template>
  <slot />
</template>
