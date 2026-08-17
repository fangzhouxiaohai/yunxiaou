<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="term-toolbar">
        <span class="term-title">终端 — {{ serverStore.current.host }}</span>
        <div>
          <el-button size="small" type="primary" :disabled="connected" @click="connect">连接</el-button>
          <el-button size="small" type="danger" :disabled="!connected" @click="disconnect">断开</el-button>
        </div>
      </div>
      <div ref="termEl" class="term-box" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'

const serverStore = useServerStore()
const userStore = useUserStore()
const termEl = ref<HTMLDivElement>()

let term: Terminal | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let resizeHandler: (() => void) | null = null
const connected = ref(false)

function onResize() {
  if (fit && term && !term.disposed) {
    fit.fit()
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ resize: { rows: term.rows, cols: term.cols } }))
    }
  }
}

function connect() {
  if (!serverStore.currentId || !userStore.token || !termEl.value) return
  if (term) {
    term.dispose()
  }
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    theme: { background: '#0d1117', foreground: '#c9d1d9' },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termEl.value)
  fit.fit()

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/terminal/ws?token=${encodeURIComponent(userStore.token)}&serverId=${serverStore.currentId}`)

  ws.onopen = () => {
    connected.value = true
    term?.clear()
    term?.onData((d) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(d)
    })
    onResize()
  }
  ws.onmessage = (e) => {
    term?.write(e.data as string)
  }
  ws.onclose = () => {
    connected.value = false
    term?.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n')
    ws = null
  }
  ws.onerror = () => {
    term?.write('\r\n\x1b[31m[连接错误]\x1b[0m\r\n')
  }
  resizeHandler = onResize
  window.addEventListener('resize', resizeHandler)
}

function disconnect() {
  if (ws) {
    ws.close()
    ws = null
  }
  connected.value = false
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
}

onBeforeUnmount(() => {
  disconnect()
  if (term) {
    term.dispose()
    term = null
  }
})
</script>

<style scoped lang="scss">
.term-toolbar {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
  .term-title { font-weight: 600; }
}
.term-box {
  height: calc(100vh - 220px); min-height: 400px; background: #0d1117;
  border-radius: 6px; overflow: hidden; padding: 8px;
}
</style>
