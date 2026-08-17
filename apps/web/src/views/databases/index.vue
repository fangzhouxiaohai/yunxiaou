<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <el-tabs v-else v-model="activeTab">
    <el-tab-pane label="MySQL/MariaDB" name="mysql">
      <el-card>
        <div class="toolbar">
          <el-button type="primary" @click="dbDialogVisible = true">创建数据库</el-button>
        </div>
        <el-table :data="databases" v-loading="dbLoading">
          <el-table-column prop="name" label="数据库名" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button link type="danger" @click="onDropDb(row.name)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-tab-pane>

    <el-tab-pane label="Redis" name="redis">
      <el-row :gutter="16">
        <el-col :span="6"><el-card><div class="stat"><div class="label">版本</div><div class="value">{{ redisInfo?.version || '--' }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">内存占用</div><div class="value">{{ memText }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">连接数</div><div class="value">{{ redisInfo?.connectedClients ?? '--' }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">命中率</div><div class="value">{{ redisInfo ? redisInfo.hitRate + '%' : '--' }}</div></div></el-card></el-col>
      </el-row>
      <el-card class="row-gap">
        <template #header>
          <div class="redis-header">
            <span>键列表（共 {{ redisInfo?.totalKeys ?? 0 }} 个键）</span>
            <div>
              <el-button size="small" @click="loadRedis">刷新</el-button>
              <el-button size="small" type="danger" @click="onFlushRedis">清空当前库</el-button>
            </div>
          </div>
        </template>
        <el-table :data="redisKeys" v-loading="redisLoading" max-height="360">
          <el-table-column prop="key" label="键名" />
        </el-table>
      </el-card>
    </el-tab-pane>
  </el-tabs>

  <el-dialog v-model="dbDialogVisible" title="创建数据库" width="440px">
    <el-form :model="dbForm" label-width="90px">
      <el-form-item label="数据库名" required>
        <el-input v-model="dbForm.name" placeholder="字母/数字/下划线" />
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="dbForm.username" />
      </el-form-item>
      <el-form-item label="密码" required>
        <el-input v-model="dbForm.password" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dbDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="dbSaving" @click="onCreateDb">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createDatabase, dropDatabase, flushRedis, getRedisInfo, listDatabases, listRedisKeys, type RedisInfo } from '@/api/database'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('mysql')
const databases = ref<Array<{ name: string }>>([])
const dbLoading = ref(false)
const dbDialogVisible = ref(false)
const dbSaving = ref(false)
const dbForm = reactive({ name: '', username: '', password: '' })
const redisInfo = ref<RedisInfo | null>(null)
const redisKeys = ref<Array<{ key: string }>>([])
const redisLoading = ref(false)

const memText = computed(() => {
  const m = redisInfo.value?.usedMemory
  return m === undefined ? '--' : m >= 1048576 ? `${(m / 1048576).toFixed(1)} MB` : `${Math.round(m / 1024)} KB`
})

async function loadDatabases() {
  if (!serverStore.currentId) return
  dbLoading.value = true
  try {
    const names = await listDatabases(serverStore.currentId)
    databases.value = names.map((name) => ({ name }))
  } finally {
    dbLoading.value = false
  }
}

async function loadRedis() {
  if (!serverStore.currentId) return
  redisLoading.value = true
  try {
    redisInfo.value = await getRedisInfo(serverStore.currentId)
    const keys = await listRedisKeys(serverStore.currentId)
    redisKeys.value = keys.map((key) => ({ key }))
  } finally {
    redisLoading.value = false
  }
}

onMounted(() => {
  loadDatabases()
  loadRedis()
})

async function onCreateDb() {
  if (!dbForm.name || !dbForm.username || !dbForm.password) {
    ElMessage.warning('请填写完整信息')
    return
  }
  dbSaving.value = true
  try {
    await createDatabase(serverStore.currentId!, { ...dbForm })
    ElMessage.success('创建成功')
    dbDialogVisible.value = false
    dbForm.name = ''
    dbForm.username = ''
    dbForm.password = ''
    loadDatabases()
  } finally {
    dbSaving.value = false
  }
}

async function onDropDb(name: string) {
  await ElMessageBox.confirm(
    `将备份后删除数据库「${name}」，该操作不可恢复。`, '删除数据库', { type: 'warning' }
  )
  await dropDatabase(serverStore.currentId!, name, true)
  ElMessage.success('已删除（备份在服务器 /tmp/linuxmgr-db-backup/）')
  loadDatabases()
}

async function onFlushRedis() {
  await ElMessageBox.confirm('将清空当前 Redis 库的所有键，不可恢复。', '清空 Redis', { type: 'warning' })
  await flushRedis(serverStore.currentId!, true)
  ElMessage.success('已清空')
  loadRedis()
}
</script>

<style scoped lang="scss">
.toolbar { margin-bottom: 16px; }
.row-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 20px; font-weight: 600; }
}
.redis-header { display: flex; justify-content: space-between; align-items: center; }
</style>
