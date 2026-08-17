<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="page-header">
        <span class="page-title">计划任务</span>
        <div class="page-actions">
          <el-button type="primary" @click="openDialog">新增计划任务</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
      </div>
      <el-table :data="entries" v-loading="loading">
        <el-table-column prop="line" label="任务" min-width="360" show-overflow-tooltip />
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.ours" type="success" size="small">云小U</el-tag>
            <el-tag v-else type="info" size="small">系统</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button v-if="row.ours" link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增计划任务" width="min(520px, 92vw)">
      <el-form label-width="100px">
        <el-form-item label="任务类型" required>
          <el-radio-group v-model="taskType">
            <el-radio-button value="shell">Shell 命令</el-radio-button>
            <el-radio-button value="url">URL 请求</el-radio-button>
            <el-radio-button value="python">Python 脚本</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="执行周期" required>
          <el-radio-group v-model="period">
            <el-radio-button value="minute">每分钟</el-radio-button>
            <el-radio-button value="hour">每小时</el-radio-button>
            <el-radio-button value="day">每天</el-radio-button>
            <el-radio-button value="week">每周</el-radio-button>
            <el-radio-button value="month">每月</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="period === 'hour'" label="分钟">
          <el-select v-model="hourMinute" style="width: 120px">
            <el-option v-for="m in 60" :key="m - 1" :label="`第 ${m - 1} 分`" :value="m - 1" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="period === 'day'" label="执行时间">
          <el-time-picker v-model="dayTime" format="HH:mm" value-format="HH:mm" placeholder="选择时间" />
        </el-form-item>

        <el-form-item v-if="period === 'week'" label="星期">
          <el-select v-model="weekDay" style="width: 140px">
            <el-option v-for="(d, i) in ['周一', '周二', '周三', '周四', '周五', '周六', '周日']" :key="i + 1" :label="d" :value="i + 1" />
          </el-select>
          <el-time-picker v-model="dayTime" format="HH:mm" value-format="HH:mm" placeholder="时间" class="time-gap" />
        </el-form-item>

        <el-form-item v-if="period === 'month'" label="日期">
          <el-select v-model="monthDay" style="width: 120px">
            <el-option v-for="d in 31" :key="d" :label="`${d} 日`" :value="d" />
          </el-select>
          <el-time-picker v-model="dayTime" format="HH:mm" value-format="HH:mm" placeholder="时间" class="time-gap" />
        </el-form-item>

        <el-form-item v-if="period === 'custom'" label="表达式" required>
          <el-input v-model="form.expression" placeholder="分 时 日 月 周，如 0 2 * * *" />
        </el-form-item>

        <!-- Shell -->
        <el-form-item v-if="taskType === 'shell'" label="命令" required>
          <el-input v-model="form.command" placeholder="如 /usr/bin/backup.sh 或 node /www/app/cron.js" />
        </el-form-item>

        <!-- URL -->
        <template v-if="taskType === 'url'">
          <el-form-item label="请求方式" required>
            <el-radio-group v-model="urlMethod">
              <el-radio-button value="GET">GET</el-radio-button>
              <el-radio-button value="POST">POST</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="URL" required>
            <el-input v-model="urlTarget" placeholder="https://example.com/ping" />
          </el-form-item>
          <el-form-item v-if="urlMethod === 'POST'" label="POST 数据">
            <el-input v-model="postData" placeholder="如 a=1&b=2（表单格式）" />
          </el-form-item>
        </template>

        <!-- Python -->
        <el-form-item v-if="taskType === 'python'" label="脚本路径" required>
          <el-input v-model="form.scriptPath" placeholder="如 /opt/scripts/cleanup.py" />
        </el-form-item>

        <el-form-item label="命令预览">
          <el-tag class="preview-tag">{{ execPreview || '请选择周期与任务类型' }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createCrontab, deleteCrontab, listCrontabs, type CrontabEntry } from '@/api/crontab'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const entries = ref<CrontabEntry[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const form = reactive({ expression: '', command: '', scriptPath: '' })
const taskType = ref<'shell' | 'url' | 'python'>('shell')
const period = ref('day')
const hourMinute = ref(0)
const dayTime = ref('02:00')
const weekDay = ref(1)
const monthDay = ref(1)
const urlMethod = ref<'GET' | 'POST'>('GET')
const urlTarget = ref('')
const postData = ref('')

// 根据周期生成 cron 表达式（用户无需手输）
const expressionPreview = computed(() => {
  const h = dayTime.value ? dayTime.value.split(':')[0] : '0'
  const m = dayTime.value ? dayTime.value.split(':')[1] : '0'
  switch (period.value) {
    case 'minute': return '* * * * *'
    case 'hour': return `${hourMinute.value} * * * *`
    case 'day': return `${m} ${h} * * *`
    case 'week': return `${m} ${h} * * ${weekDay.value}`
    case 'month': return `${m} ${h} ${monthDay.value} * *`
    default: return form.expression.trim()
  }
})

// 执行命令预览（按任务类型）
const execPreview = computed(() => {
  if (taskType.value === 'shell') return form.command.trim()
  if (taskType.value === 'python') return form.scriptPath.trim() ? `python3 ${form.scriptPath.trim()}` : ''
  if (taskType.value === 'url') {
    if (!urlTarget.value.trim()) return ''
    const dataPart = urlMethod.value === 'POST' && postData.value ? ` -d '${postData.value}'` : ''
    return `curl -s -o /dev/null -w "%{http_code}" -X ${urlMethod.value}${dataPart} '${urlTarget.value.trim()}'`
  }
  return ''
})

function openDialog() {
  form.expression = ''
  form.command = ''
  form.scriptPath = ''
  taskType.value = 'shell'
  period.value = 'day'
  dayTime.value = '02:00'
  urlTarget.value = ''
  postData.value = ''
  urlMethod.value = 'GET'
  dialogVisible.value = true
}

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    entries.value = await listCrontabs(serverStore.currentId)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function onCreate() {
  const expression = expressionPreview.value
  if (!expression) {
    ElMessage.warning('请选择执行周期')
    return
  }
  // 按类型组装参数
  const payload: Record<string, unknown> = { expression }
  if (taskType.value === 'shell') {
    if (!form.command.trim()) {
      ElMessage.warning('请输入 Shell 命令')
      return
    }
    payload.type = 'shell'
    payload.command = form.command.trim()
  } else if (taskType.value === 'url') {
    if (!urlTarget.value.trim()) {
      ElMessage.warning('请输入 URL')
      return
    }
    payload.type = 'url'
    payload.method = urlMethod.value
    payload.url = urlTarget.value.trim()
    if (urlMethod.value === 'POST' && postData.value) payload.postData = postData.value
  } else {
    if (!form.scriptPath.trim()) {
      ElMessage.warning('请输入 Python 脚本路径')
      return
    }
    payload.type = 'python'
    payload.scriptPath = form.scriptPath.trim()
  }
  saving.value = true
  try {
    await createCrontab(serverStore.currentId!, payload as never)
    ElMessage.success('已创建')
    dialogVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function onDelete(row: CrontabEntry) {
  await ElMessageBox.confirm(`确定删除计划任务「${row.line.slice(0, 80)}」吗？`, '删除确认', { type: 'warning' })
  await deleteCrontab(serverStore.currentId!, row.id!, true)
  ElMessage.success('已删除')
  await load()
}
</script>

<style scoped lang="scss">
.time-gap { margin-left: 12px; }
.preview-tag { max-width: 100%; white-space: normal; height: auto; line-height: 1.5; word-break: break-all; }
</style>
