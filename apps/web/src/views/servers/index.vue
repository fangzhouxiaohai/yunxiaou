<template>
  <el-card>
    <div class="toolbar">
      <el-button type="primary" @click="openDialog()">新增服务器</el-button>
    </div>
    <el-table :data="serverStore.servers" v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="120" />
      <el-table-column prop="host" label="主机" min-width="140" />
      <el-table-column prop="port" label="端口" width="80" />
      <el-table-column prop="username" label="用户名" width="100" />
      <el-table-column label="连接状态" width="220">
        <template #default="{ row }">
          <el-button link type="primary" :loading="testingId === row.id" @click="onTest(row)">
            测试连接
          </el-button>
          <span v-if="testResult[row.id]" :class="testResult[row.id].ok ? 'ok' : 'fail'">
            {{ testResult[row.id].ok ? `正常 (${testResult[row.id].uname})` : '失败' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
          <el-button link type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="form.id ? '编辑服务器' : '新增服务器'" width="480px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="如：生产环境-Web" />
      </el-form-item>
      <el-form-item label="主机" required>
        <el-input v-model="form.host" placeholder="IP 或域名，如 43.240.221.112" />
      </el-form-item>
      <el-form-item label="端口" required>
        <el-input-number v-model="form.port" :min="1" :max="65535" />
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="form.username" placeholder="如 root" />
      </el-form-item>
      <el-form-item :label="form.id ? '密码(留空不变)' : '密码'" required>
        <el-input v-model="form.password" type="password" show-password placeholder="SSH 密码（加密存储）" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createServer, deleteServer, testServer, updateServer, type ServerPayload } from '@/api/servers'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const loading = ref(false)
const saving = ref(false)
const testingId = ref('')
const testResult = reactive<Record<string, { ok: boolean; uname?: string }>>({})
const dialogVisible = ref(false)
const form = reactive<{ id?: string; name: string; host: string; port: number; username: string; password: string }>({
  name: '', host: '', port: 22, username: 'root', password: '',
})

onMounted(async () => {
  loading.value = true
  try {
    await serverStore.load()
  } finally {
    loading.value = false
  }
})

function openDialog(row?: { id: string; name: string; host: string; port: number; username: string }) {
  if (row) {
    form.id = row.id
    form.name = row.name
    form.host = row.host
    form.port = row.port
    form.username = row.username
    form.password = ''
  } else {
    form.id = undefined
    form.name = ''
    form.host = ''
    form.port = 22
    form.username = 'root'
    form.password = ''
  }
  dialogVisible.value = true
}

async function onSave() {
  if (!form.name || !form.host || !form.username) {
    ElMessage.warning('请填写名称、主机和用户名')
    return
  }
  saving.value = true
  try {
    const payload: ServerPayload = { name: form.name, host: form.host, port: form.port, username: form.username }
    if (form.password) payload.password = form.password
    if (form.id) {
      await updateServer(form.id, payload)
      ElMessage.success('已更新')
    } else {
      if (!form.password) {
        ElMessage.warning('新增服务器必须填写密码')
        return
      }
      await createServer(payload)
      ElMessage.success('已添加')
    }
    dialogVisible.value = false
    await serverStore.load()
  } finally {
    saving.value = false
  }
}

async function onTest(row: { id: string }) {
  testingId.value = row.id
  try {
    const data = await testServer(row.id)
    testResult[row.id] = data
    if (data.ok) ElMessage.success(`连接成功：${data.uname}`)
  } catch {
    testResult[row.id] = { ok: false }
  } finally {
    testingId.value = ''
  }
}

async function onDelete(row: { id: string; name: string }) {
  await ElMessageBox.confirm(`确定删除服务器「${row.name}」吗？将断开其 SSH 连接。`, '删除确认', { type: 'warning' })
  await deleteServer(row.id)
  ElMessage.success('已删除')
  await serverStore.load()
}
</script>

<style scoped lang="scss">
.toolbar { margin-bottom: 16px; }
.ok { color: #67c23a; font-size: 12px; }
.fail { color: #f56c6c; font-size: 12px; }
</style>
