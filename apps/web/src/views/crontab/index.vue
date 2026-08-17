<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="dialogVisible = true">新增计划任务</el-button>
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

    <el-dialog v-model="dialogVisible" title="新增计划任务" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="表达式" required>
          <el-input v-model="form.expression" placeholder="分 时 日 月 周，如 0 2 * * *" />
        </el-form-item>
        <el-form-item label="命令" required>
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
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createCrontab, deleteCrontab, listCrontabs, type CrontabEntry } from '@/api/crontab'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const entries = ref<CrontabEntry[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const form = reactive({ expression: '', command: '' })

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
  if (!form.expression || !form.command) {
    ElMessage.warning('请填写表达式和命令')
    return
  }
  saving.value = true
  try {
    await createCrontab(serverStore.currentId!, { ...form })
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
</style>
