<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="toolbar">
        <el-select v-model="logPath" placeholder="选择日志文件" style="width: 320px" @change="load">
          <el-option v-for="f in files" :key="f.path" :label="`${f.path}${f.exists ? ` (${(f.size / 1024).toFixed(0)}KB)` : ' (不存在)'}`" :value="f.path" />
        </el-select>
        <el-input v-model="customPath" placeholder="自定义路径（/var/log 下）" style="width: 280px" @keyup.enter="useCustom" />
        <el-button @click="useCustom">读取</el-button>
        <el-select v-model="lines" style="width: 110px">
          <el-option :value="100" label="100 行" />
          <el-option :value="200" label="200 行" />
          <el-option :value="500" label="500 行" />
        </el-select>
        <el-switch v-model="autoRefresh" active-text="自动刷新" />
      </div>
      <pre class="log-box">{{ content || '（选择日志文件查看内容）' }}</pre>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { listLogFiles, readLog, type LogFile } from '@/api/logs'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const files = ref<LogFile[]>([])
const logPath = ref('')
const customPath = ref('')
const lines = ref(200)
const content = ref('')
const autoRefresh = ref(false)
let timer: number | undefined

async function load() {
  if (!serverStore.currentId || !logPath.value) return
  content.value = await readLog(serverStore.currentId, logPath.value, lines.value)
}

function useCustom() {
  if (customPath.value.trim()) {
    logPath.value = customPath.value.trim()
    load()
  }
}

onMounted(async () => {
  if (serverStore.currentId) {
    files.value = await listLogFiles(serverStore.currentId)
    const first = files.value.find((f) => f.exists)
    if (first) {
      logPath.value = first.path
      load()
    }
  }
  timer = window.setInterval(() => {
    if (autoRefresh.value && logPath.value) load()
  }, 3000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped lang="scss">
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.log-box {
  background: #0d1117; color: #c9d1d9; padding: 16px; border-radius: 6px;
  font-size: 12px; line-height: 1.6; max-height: 65vh; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
</style>
