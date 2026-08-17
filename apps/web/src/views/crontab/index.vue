<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="openDialog">新增计划任务</el-button>
        <el-button @click="load">刷新</el-button>
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

    <el-dialog v-model="dialogVisible" title="新增计划任务" width="520px">
      <el-form label-width="100px">
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

        <el-form-item v-if="period !== 'custom'" label="命令" required>
          <el-input v-model="form.command" placeholder="如 /usr/bin/backup.sh" />
        </el-form-item>
        <el-form-item v-if="period !== 'custom'" label="预览">
          <el-tag>{{ expressionPreview || '请选择周期' }}</el-tag>
        </el-form-item>
        <el-form-item v-if="period === 'custom'" label="命令" required>
          <el-input v-model="form.command" placeholder="如 /usr/bin/backup.sh" />
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
const form = reactive({ expression: '', command: '' })
const period = ref('day')
const hourMinute = ref(0)
const dayTime = ref('02:00')
const weekDay = ref(1)
const monthDay = ref(1)

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
    default: return ''
  }
})

function openDialog() {
  form.expression = ''
  form.command = ''
  period.value = 'day'
  dayTime.value = '02:00'
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
  const expression = period.value === 'custom' ? form.expression.trim() : expressionPreview.value
  if (!expression || !form.command) {
    ElMessage.warning('请填写完整信息')
    return
  }
  saving.value = true
  try {
    await createCrontab(serverStore.currentId!, { expression, command: form.command })
    ElMessage.success('已创建')
    dialogVisible.value = false
    form.expression = ''
    form.command = ''
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
.toolbar { margin-bottom: 16px; }
.time-gap { margin-left: 12px; }
</style>
