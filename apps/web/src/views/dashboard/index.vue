<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加服务器，并在顶部选择要监控的服务器" />
  </div>
  <div v-else>
    <el-row :gutter="16">
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">CPU 使用率</div>
          <div class="value">{{ cpuText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">内存</div>
          <div class="value">{{ memText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">磁盘（根分区）</div>
          <div class="value">{{ diskText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">负载（1/5/15 分钟）</div>
          <div class="value">{{ loadText }}</div>
        </div></el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="row-gap">
      <el-col :span="12">
        <el-card>
          <template #header>CPU 使用率（%）</template>
          <div ref="cpuChartEl" class="chart" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>网络速率（KB/s）</template>
          <div ref="netChartEl" class="chart" />
        </el-card>
      </el-col>
    </el-row>

    <el-card class="row-gap">
      <template #header>系统信息</template>
      <el-descriptions :column="3" border size="small">
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import { getMonitor, type MonitorData } from '@/api/monitor'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
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

function pushHistory(data: MonitorData) {
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  history.time.push(now)
  history.cpu.push(Number((data.cpu.us + data.cpu.sy).toFixed(1)))
  history.rx.push(Number((data.net.rxRate / 1024).toFixed(1)))
  history.tx.push(Number((data.net.txRate / 1024).toFixed(1)))
  if (history.time.length > 60) {
    history.time.shift()
    history.cpu.shift()
    history.rx.shift()
    history.tx.shift()
  }
}

function updateCharts() {
  if (!cpuChart || !netChart) return
  cpuChart.setOption({
    xAxis: { type: 'category', data: history.time },
    yAxis: { type: 'value', max: 100 },
    series: [{ type: 'line', smooth: true, data: history.cpu, areaStyle: {} }],
  })
  netChart.setOption({
    xAxis: { type: 'category', data: history.time },
    yAxis: { type: 'value' },
    series: [
      { name: '下行', type: 'line', smooth: true, data: history.rx, areaStyle: {} },
      { name: '上行', type: 'line', smooth: true, data: history.tx, areaStyle: {} },
    ],
  })
}

async function refresh() {
  if (!serverStore.currentId) return
  try {
    const data = await getMonitor(serverStore.currentId)
    current.value = data
    pushHistory(data)
    updateCharts()
  } catch {
    /* 错误已由拦截器提示 */
  }
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
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  cpuChart?.dispose()
  netChart?.dispose()
})
</script>

<style scoped lang="scss">
.row-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 22px; font-weight: 600; }
}
.chart { height: 300px; }
</style>
