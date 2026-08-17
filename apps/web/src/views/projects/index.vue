<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <div class="page-header">
      <span class="page-title">网站管理</span>
      <div class="page-actions">
        <el-button type="primary" @click="dialogVisible = true">创建网站</el-button>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>
    <el-card>
      <div class="hint">PHP 项目走 Nginx+php-fpm；Node/Python/Java 项目走 systemd 服务（linuxmgr- 前缀）</div>
      <el-table :data="projects" v-loading="loading">
        <el-table-column prop="name" label="项目名" min-width="180" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.type.toUpperCase() }}{{ row.phpVersion ? ` ${row.phpVersion}` : '' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="directory" label="目录" min-width="150" show-overflow-tooltip />
        <el-table-column prop="port" label="端口" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '运行中' : row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'active'"
              link
              type="success"
              :loading="acting === `${row.name}:start`"
              @click="onControl(row, 'start')"
            >启动</el-button>
            <el-button
              v-if="row.status === 'active'"
              link
              type="warning"
              :loading="acting === `${row.name}:stop`"
              @click="onControl(row, 'stop')"
            >停止</el-button>
            <el-button
              v-if="row.status === 'active'"
              link
              type="primary"
              :loading="acting === `${row.name}:restart`"
              @click="onControl(row, 'restart')"
            >重启</el-button>
            <el-button link type="info" @click="onLogs(row)">日志</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="创建网站" width="min(540px, 92vw)">
      <el-form :model="form" label-width="100px">
        <el-form-item label="项目名" required>
          <el-input v-model="form.name" placeholder="字母/数字/_-（将加 linuxmgr- 前缀）" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.type">
            <el-radio-button value="php">PHP</el-radio-button>
            <el-radio-button value="node">Node.js</el-radio-button>
            <el-radio-button value="python">Python</el-radio-button>
            <el-radio-button value="java">Java</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="源码目录" required>
          <el-input v-model="form.directory" placeholder="如 /www/myapp（不存在会自动创建）" />
        </el-form-item>
        <el-form-item label="运行端口" required>
          <el-input-number v-model="form.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="域名">
          <el-input v-model="form.domain" placeholder="可选，如 blog.example.com（SSL 证书将按此域名生成）" />
        </el-form-item>
        <el-form-item v-if="form.type === 'php'" label="PHP 版本" required>
          <el-select v-model="form.phpVersion" placeholder="选择 PHP 版本">
            <el-option v-for="v in ['php74', 'php80', 'php81', 'php82', 'php83']" :key="v" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="启动命令" required>
          <el-input v-model="form.entry" placeholder="如 node server.js / python3 app.py / java -jar app.jar" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="logDrawer" title="网站日志" :size="drawerSize">
      <div class="log-toolbar">
        <el-button size="small" @click="loadLogs">刷新</el-button>
      </div>
      <pre class="code-box">{{ logs }}</pre>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  controlProject, createProject, deleteProject, getProjectLogs, listProjects, type Project,
} from '@/api/projects'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const projects = ref<Project[]>([])
const loading = ref(false)
const acting = ref('')
const saving = ref(false)
const dialogVisible = ref(false)
const form = reactive({
  name: '', type: 'node', directory: '', port: 3000, entry: '', phpVersion: 'php82', domain: '',
})
const logDrawer = ref(false)
const logs = ref('')
let logProjectName = ''

const drawerSize = computed(() => (window.innerWidth < 768 ? '100%' : '60%'))

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    projects.value = await listProjects(serverStore.currentId)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function onCreate() {
  if (!form.name || !form.directory) {
    ElMessage.warning('请填写项目名和目录')
    return
  }
  if (form.type !== 'php' && !form.entry) {
    ElMessage.warning('请填写启动命令')
    return
  }
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name, type: form.type, directory: form.directory, port: form.port,
    }
    if (form.type === 'php') payload.phpVersion = form.phpVersion
    else payload.entry = form.entry
    if (form.domain.trim()) payload.domain = form.domain.trim()
    await createProject(serverStore.currentId!, payload as never)
    ElMessage.success('项目创建成功')
    dialogVisible.value = false
    form.name = ''
    form.entry = ''
    form.domain = ''
    await load()
  } finally {
    saving.value = false
  }
}

async function onControl(row: Project, action: 'start' | 'stop' | 'restart') {
  acting.value = `${row.name}:${action}`
  try {
    await controlProject(serverStore.currentId!, row.name, action)
    ElMessage.success(`${action} 成功`)
    await load()
  } finally {
    acting.value = ''
  }
}

async function onLogs(row: Project) {
  logProjectName = row.name
  logDrawer.value = true
  logs.value = '加载中...'
  await loadLogs()
}

async function loadLogs() {
  if (!logProjectName) return
  logs.value = await getProjectLogs(serverStore.currentId!, logProjectName)
}

async function onDelete(row: Project) {
  await ElMessageBox.confirm(
    `确定删除网站「${row.name}」吗？将停止并移除其服务配置（vhost 备份在服务器 /tmp/linuxmgr-backup/）。`,
    '删除网站',
    { type: 'warning' }
  )
  await deleteProject(serverStore.currentId!, row.name, true)
  ElMessage.success('已删除')
  await load()
}
</script>

<style scoped lang="scss">
.hint { font-size: 12px; color: #909399; margin-bottom: 16px; }
.log-toolbar { margin-bottom: 12px; }
.code-box { max-height: 70vh; }
</style>
