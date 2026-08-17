<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else-if="!available">
    <el-alert
      :title="message || 'Supervisor 未安装'"
      type="warning"
      show-icon
      :closable="false"
      class="alert-gap"
    />
    <el-button type="primary" @click="goStore">去软件商店安装</el-button>
  </div>
  <div v-else>
    <el-card>
      <div class="page-header">
        <span class="page-title">进程守护</span>
        <div class="page-actions">
          <el-button type="primary" @click="dialogVisible = true">新建进程</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
      </div>
      <el-table :data="programs" v-loading="loading">
        <el-table-column prop="name" label="进程名" min-width="180" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'RUNNING' ? 'success' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="pid" label="PID" width="90" />
        <el-table-column prop="uptime" label="运行时长" min-width="140" />
        <el-table-column label="操作" width="240">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'RUNNING'"
              link
              type="success"
              :loading="acting === `${row.name}:start`"
              @click="onControl(row, 'start')"
            >启动</el-button>
            <el-button
              v-if="row.status === 'RUNNING'"
              link
              type="warning"
              :loading="acting === `${row.name}:stop`"
              @click="onControl(row, 'stop')"
            >停止</el-button>
            <el-button
              v-if="row.status === 'RUNNING'"
              link
              type="primary"
              :loading="acting === `${row.name}:restart`"
              @click="onControl(row, 'restart')"
            >重启</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新建守护进程" width="min(520px, 92vw)">
      <el-form :model="form" label-width="90px">
        <el-form-item label="进程名" required>
          <el-input v-model="form.name" placeholder="字母/数字/_-（将加 linuxmgr- 前缀）" />
        </el-form-item>
        <el-form-item label="启动命令" required>
          <el-input v-model="form.command" placeholder="如 node /www/app/server.js" />
        </el-form-item>
        <el-form-item label="工作目录">
          <el-input v-model="form.directory" placeholder="如 /www/app" />
        </el-form-item>
        <el-form-item label="运行用户">
          <el-input v-model="form.user" placeholder="root" />
        </el-form-item>
        <el-form-item label="开机自启">
          <el-switch v-model="form.autostart" />
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
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { controlProgram, createProgram, deleteProgram, getSupervisor, type Program } from '@/api/supervisor'
import { useServerStore } from '@/stores/server'

const router = useRouter()
const serverStore = useServerStore()
const available = ref(false)
const message = ref('')
const programs = ref<Program[]>([])
const loading = ref(false)
const acting = ref('')
const saving = ref(false)
const dialogVisible = ref(false)
const form = reactive({ name: '', command: '', directory: '', user: 'root', autostart: true })

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    const data = await getSupervisor(serverStore.currentId)
    available.value = data.available
    message.value = data.message || ''
    programs.value = data.programs
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goStore() {
  router.push('/store')
}

async function onCreate() {
  if (!form.name || !form.command) {
    ElMessage.warning('请填写进程名和启动命令')
    return
  }
  saving.value = true
  try {
    await createProgram(serverStore.currentId!, { ...form })
    ElMessage.success('创建成功')
    dialogVisible.value = false
    form.name = ''
    form.command = ''
    form.directory = ''
    await load()
  } finally {
    saving.value = false
  }
}

async function onControl(row: Program, action: 'start' | 'stop' | 'restart') {
  acting.value = `${row.name}:${action}`
  try {
    await controlProgram(serverStore.currentId!, row.name, action)
    ElMessage.success(`${action} 成功`)
    await load()
  } finally {
    acting.value = ''
  }
}

async function onDelete(row: Program) {
  await ElMessageBox.confirm(`确定删除进程配置「${row.name}」吗？`, '删除确认', { type: 'warning' })
  await deleteProgram(serverStore.currentId!, row.name, true)
  ElMessage.success('已删除')
  await load()
}
</script>

<style scoped lang="scss">
.alert-gap { margin-bottom: 16px; }
</style>
