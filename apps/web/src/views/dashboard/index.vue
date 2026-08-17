<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加服务器，并在顶部选择要监控的服务器" />
  </div>
  <div v-else>
    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#3b6fe0"><Cpu /></el-icon>
            <div>
              <div class="label">CPU 使用率</div>
              <div class="value num">{{ cpuText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#34a06e"><Coin /></el-icon>
            <div>
              <div class="label">内存</div>
              <div class="value num">{{ memText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#d98e2b"><Files /></el-icon>
            <div>
              <div class="label">磁盘（根分区）</div>
              <div class="value num">{{ diskText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#7a5fd0"><Odometer /></el-icon>
            <div>
              <div class="label">负载（1/5/15 分钟）</div>
              <div class="value num">{{ loadText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="row-gap">
      <el-col :xs="24" :lg="12">
        <el-card>
          <template #header>CPU 使用率（%）</template>
          <div ref="cpuChartEl" class="chart" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card>
          <template #header>网络速率（KB/s）</template>
          <div ref="netChartEl" class="chart" />
        </el-card>
      </el-col>
    </el-row>

    <el-card class="row-gap">
      <template #header>系统信息</template>
      <el-descriptions :column="descColumn" border size="small">
        <el-descriptions-item label="操作系统">{{ current?.os || '--' }}</el-descriptions-item>
        <el-descriptions-item label="运行时长">{{ uptimeText }}</el-descriptions-item>
        <el-descriptions-item label="内存可用">{{ memAvailText }}</el-descriptions-item>
        <el-descriptions-item v-for="d in current?.disk || []" :key="d.mount" :label="`磁盘 ${d.mount}`">
          {{ d.used }} / {{ d.size }}（{{ d.percent }}%）
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { Cpu, Coin, Files, Odometer } from '@element-plus/icons-vue'
import { getMonitor, type MonitorData } from '@/api/monitor'
import { useServerStore } from '@/stores/server'
import { useThemeStore } from '@/stores/theme'

const serverStore = useServerStore()
const themeStore = useThemeStore()
const current = ref<MonitorData | null>(null)
const cpuChartEl = ref<HTMLDivElement>()
const netChartEl = ref<HTMLDivElement>()

let cpuChart: echarts.ECharts | null = null
let netChart: echarts.ECharts | null = null
let timer: number | undefined
const history = {
  cpu: [] as number[],
  rx: [] as number[],
  tx: [] as number[],
  time: [] as string[],
}
const MAX_POINTS = 60

const cpuText = computed(() => (current.value ? `${(current.value.cpu.us + current.value.cpu.sy).toFixed(1)}%` : '--'))
const memText = computed(() => {
  const m = current.value?.mem
  return m ? `${m.usedMB} / ${m.totalMB} MB（${m.percent}%）` : '--'
})
const diskText = computed(() => {
  const root = current.value?.disk.find((d) => d.mount === '/')
  return root ? `${root.used} / ${root.size}（${root.percent}%）` : '--'
})
const loadText = computed(() => (current.value ? current.value.load.map((n) => n.toFixed(2)).join(' / ') : '--'))
const uptimeText = computed(() => {
  const s = current.value?.uptimeSec ?? 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d} 天 ${h} 小时 ${m} 分` : `${h} 小时 ${m} 分`
})
const memAvailText = computed(() => {
  const m = current.value?.mem
  return m ? `${m.availMB} MB` : '--'
})
const descColumn = computed(() => (window.innerWidth < 768 ? 1 : window.innerWidth < 1200 ? 2 : 3))

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function baseChartOption(yMax?: number): echarts.EChartsOption {
  const dark = themeStore.mode === 'dark'
  return {
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: history.time,
      axisLine: { lineStyle: { color: dark ? '#3a4454' : '#d8dde6' } },
      axisLabel: { color: cssVar('--text-3') || '#98a1ad' },
    },
    yAxis: {
      type: 'value',
      max: yMax,
      axisLabel: { color: cssVar('--text-3') || '#98a1ad' },
      splitLine: { lineStyle: { color: dark ? '#2a3342' : '#edf0f5' } },
    },
  }
}

function pushHistory(data: MonitorData) {
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  history.time.push(now)
  history.cpu.push(Number((data.cpu.us + data.cpu.sy).toFixed(1)))
  history.rx.push(Number((data.net.rxRate / 1024).toFixed(1)))
  history.tx.push(Number((data.net.txRate / 1024).toFixed(1)))
  if (history.time.length > MAX_POINTS) {
    history.time.shift()
    history.cpu.shift()
    history.rx.shift()
    history.tx.shift()
  }
}

function renderCharts() {
  if (!cpuChart || !netChart) return
  cpuChart.setOption({
    ...baseChartOption(100),
    series: [{ name: 'CPU', type: 'line', smooth: true, showSymbol: false, data: history.cpu, lineStyle: { color: '#3b6fe0' }, areaStyle: { color: 'rgba(59,111,224,0.15)' } }],
  })
  netChart.setOption({
    ...baseChartOption(),
    series: [
      { name: '下行', type: 'line', smooth: true, showSymbol: false, data: history.rx, lineStyle: { color: '#34a06e' }, areaStyle: { color: 'rgba(52,160,110,0.12)' } },
      { name: '上行', type: 'line', smooth: true, showSymbol: false, data: history.tx, lineStyle: { color: '#d98e2b' }, areaStyle: { color: 'rgba(217,142,43,0.12)' } },
    ],
  })
}

async function refresh() {
  if (!serverStore.currentId) return
  try {
    const data = await getMonitor(serverStore.currentId)
    current.value = data
    pushHistory(data)
    renderCharts()
  } catch {
    /* 错误已由拦截器提示 */
  }
}

function onResize() {
  cpuChart?.resize()
  netChart?.resize()
}

onMounted(() => {
  if (cpuChartEl.value) {
    cpuChart = echarts.init(cpuChartEl.value)
  }
  if (netChartEl.value) {
    netChart = echarts.init(netChartEl.value)
  }
  refresh()
  timer = window.setInterval(refresh, 3000)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  window.removeEventListener('resize', onResize)
  cpuChart?.dispose()
  netChart?.dispose()
})

watch(() => themeStore.mode, renderCharts)
</script>

<style scoped lang="scss">
.row-gap { margin-top: var(--gap); }
.el-col { margin-bottom: var(--gap); }
.metric-card {
  .metric { display: flex; align-items: center; gap: 14px; }
  .metric-icon { font-size: 34px; flex-shrink: 0; }
  .label { font-size: 13px; color: var(--text-3); margin-bottom: 4px; }
  .value { font-size: 20px; font-weight: 600; color: var(--text-1); }
}
.chart { height: 300px; }
</style>
