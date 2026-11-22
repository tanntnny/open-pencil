<script setup lang="ts">
import { MotionConfig } from 'motion-v'
import { ConfigProvider, TooltipProvider } from 'reka-ui'

import { provideEditor } from '@open-pencil/vue'

import { computed } from 'vue'

import { useFollowingEditorStore } from '@/app/editor/active-store'
import { useAppTheme } from '@/app/shell/theme'
import { activeTab } from '@/app/tabs'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import AppToaster from '@/components/shell/AppToaster.vue'

import type { EmbedSession } from './session'

/**
 * The editor's workspace for the embedded design, inside the providers the app's root gives it.
 * Menus, popovers and dialogs portal into `portal`, inside the embed's style scope.
 */
const { portal } = defineProps<{ session: EmbedSession; portal: HTMLElement }>()

/**
 * The design shows as soon as its tab exists, as the app's workspace shows the active tab: an open
 * finishes only once the canvas has presented the document, so it cannot wait for the open.
 */
const shown = computed(() => (activeTab.value?.kind === 'document' ? activeTab.value : null))

provideEditor(useFollowingEditorStore())
// Keeps the canvas, rulers and selection in the theme the host sets.
useAppTheme()
</script>

<template>
  <MotionConfig reduced-motion="user">
    <ConfigProvider :teleport-to="portal">
      <TooltipProvider :delay-duration="400">
        <EditorWorkspace v-if="shown" :key="shown.id" :tab="shown" />
        <AppToaster />
      </TooltipProvider>
    </ConfigProvider>
  </MotionConfig>
</template>
