<template>
  <svg class="brand-logo" :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="brand-cloud-lg" x1="4" y1="5" x2="27" y2="26" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6a9bff" />
        <stop offset="1" stop-color="#2f5cff" />
      </linearGradient>
    </defs>
    <path
      d="M9 25.5a6 6 0 0 1-1.32-11.85 7.5 7.5 0 0 1 14.62-1.05A5.75 5.75 0 0 1 23.5 25.5H9z"
      fill="url(#brand-cloud-lg)"
    />
    <path
      d="M12.5 14v4.2a3.5 3.5 0 0 0 7 0V14"
      stroke="#fff"
      stroke-width="2.1"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 26 })
</script>

<style scoped>
.brand-logo { display: block; flex-shrink: 0; }
</style>
