<script setup lang="ts">
/**
 * What the embed shows in place of a feature its host owns, such as the AI chat or collaboration:
 * nothing, in an element that takes the place's classes so the layout around it holds.
 */
defineOptions({ inheritAttrs: true })
</script>

<template>
  <div aria-hidden="true" />
</template>
