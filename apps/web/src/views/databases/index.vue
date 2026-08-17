<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <el-tabs v-else v-model="activeTab">
    <el-tab-pane label="MySQL/MariaDB" name="mysql">
      <!-- 库列表 -->
      <el-card v-if="dbView === 'list'">
        <el-alert
          v-if="mysqlUnavailable"
          :title="mysqlMessage"
          type="warning"
          show-icon
          :closable="false"
          class="alert-gap"
        />
        <div v-else class="toolbar">
          <el-button type="primary" @click="dbDialogVisible = true">创建数据库</el-button>
          <span class="hint">点击「进入」查看表与数据（phpMyAdmin 风格）</span>
        </div>
        <el-table :data="databases" v-loading="dbLoading">
          <el-table-column prop="name" label="数据库名" />
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <el-button link type="primary" @click="enterDb(row.name)">进入</el-button>
              <el-button link type="danger" @click="onDropDb(row.name)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 表列表 -->
      <el-card v-else-if="dbView === 'tables'">
        <el-page-header class="page-header" @back="dbView = 'list'">
          <template #content>{{ currentDb }} 的表</template>
          <template #extra>
            <el-button type="primary" size="small" @click="dbView = 'sql'">SQL</el-button>
            <el-button size="small" @click="loadTables">刷新</el-button>
          </template>
        </el-page-header>
        <el-table :data="tables" v-loading="tablesLoading" class="table-gap">
          <el-table-column prop="name" label="表名" />
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button link type="primary" @click="enterStructure(row.name)">结构</el-button>
              <el-button link type="success" @click="enterRows(row.name)">数据</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 表结构 -->
      <el-card v-else-if="dbView === 'structure'">
        <el-page-header class="page-header" @back="dbView = 'tables'">
          <template #content>{{ currentDb }}.{{ currentTable }} 结构</template>
        </el-page-header>
        <el-table :data="structureRows" v-loading="panelLoading" class="table-gap" border size="small">
          <el-table-column v-for="col in structure.columns" :key="col" :prop="col" :label="col" min-width="120" />
        </el-table>
      </el-card>

      <!-- 数据浏览 -->
      <el-card v-else-if="dbView === 'rows'">
        <el-page-header class="page-header" @back="dbView = 'tables'">
          <template #content>{{ currentDb }}.{{ currentTable }} 数据（共 {{ rowsTotal }} 行）</template>
          <template #extra>
            <el-button size="small" @click="loadRows">刷新</el-button>
          </template>
        </el-page-header>
        <el-table :data="rowObjects" v-loading="panelLoading" class="table-gap" border size="small" max-height="480">
          <el-table-column
            v-for="col in rowsColumns"
            :key="col"
            :prop="col"
            :label="col"
            min-width="120"
            show-overflow-tooltip
          />
        </el-table>
        <el-pagination
          class="table-gap"
          layout="total, prev, pager, next"
          :total="rowsTotal"
          :page-size="10"
          :current-page="rowsPage"
          @current-change="(p: number) => { rowsPage = p; loadRows() }"
        />
      </el-card>

      <!-- SQL 执行 -->
      <el-card v-else-if="dbView === 'sql'">
        <el-page-header class="page-header" @back="dbView = 'tables'">
          <template #content>在 {{ currentDb }} 中执行 SQL</template>
        </el-page-header>
        <el-input
          v-model="sqlText"
          type="textarea"
          :rows="6"
          class="table-gap"
          placeholder="SELECT * FROM posts LIMIT 100;"
        />
        <div class="toolbar">
          <el-button type="primary" :loading="sqlRunning" @click="onExecSql">执行</el-button>
          <span class="hint">写操作（INSERT/UPDATE/DELETE/DROP 等）需二次确认；无 WHERE 的 DELETE/UPDATE 被拦截</span>
        </div>
        <el-table
          v-if="sqlResult"
          :data="sqlResultRows"
          class="table-gap"
          border
          size="small"
          max-height="480"
        >
          <el-table-column
            v-for="col in sqlResult.columns"
            :key="col"
            :prop="col"
            :label="col"
            min-width="120"
            show-overflow-tooltip
          />
        </el-table>
      </el-card>
    </el-tab-pane>

    <el-tab-pane label="Redis" name="redis">
      <el-alert
        v-if="redisUnavailable"
        :title="redisMessage"
        type="warning"
        show-icon
        :closable="false"
        class="alert-gap"
      />
      <template v-else>
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
      </template>
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
import {
  createDatabase, dropDatabase, execSql, flushRedis, getRedisInfo, listDatabases, listRedisKeys,
  listTables, tableRows, tableStructure, type BatchResult, type RedisInfo,
} from '@/api/database'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('mysql')

// ===== MySQL 面板 =====
type DbView = 'list' | 'tables' | 'structure' | 'rows' | 'sql'
const dbView = ref<DbView>('list')
const databases = ref<Array<{ name: string }>>([])
const dbLoading = ref(false)
const dbDialogVisible = ref(false)
const dbSaving = ref(false)
const dbForm = reactive({ name: '', username: '', password: '' })
const mysqlUnavailable = ref(false)
const mysqlMessage = ref('')

const currentDb = ref('')
const currentTable = ref('')
const tables = ref<Array<{ name: string }>>([])
const tablesLoading = ref(false)
const structure = ref<BatchResult>({ columns: [], rows: [] })
const structureRows = ref<Record<string, string>[]>([])
const rowsColumns = ref<string[]>([])
const rowObjects = ref<Record<string, string>[]>([])
const rowsTotal = ref(0)
const rowsPage = ref(1)
const panelLoading = ref(false)
const sqlText = ref('')
const sqlRunning = ref(false)
const sqlResult = ref<BatchResult | null>(null)
const sqlResultRows = ref<Record<string, string>[]>([])

function zip(columns: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))
}

async function loadDatabases() {
  if (!serverStore.currentId) return
  dbLoading.value = true
  try {
    const result = await listDatabases(serverStore.currentId)
    if (!result.available) {
      mysqlUnavailable.value = true
      mysqlMessage.value = result.message || 'MySQL 未安装或未运行'
      databases.value = []
      return
    }
    mysqlUnavailable.value = false
    databases.value = (result.databases || []).map((name) => ({ name }))
  } finally {
    dbLoading.value = false
  }
}

function enterDb(db: string) {
  currentDb.value = db
  dbView.value = 'tables'
  loadTables()
}

async function loadTables() {
  if (!serverStore.currentId) return
  tablesLoading.value = true
  try {
    const names = await listTables(serverStore.currentId, currentDb.value)
    tables.value = names.map((name) => ({ name }))
  } finally {
    tablesLoading.value = false
  }
}

async function enterStructure(table: string) {
  currentTable.value = table
  dbView.value = 'structure'
  panelLoading.value = true
  try {
    structure.value = await tableStructure(serverStore.currentId!, currentDb.value, table)
    structureRows.value = zip(structure.value.columns, structure.value.rows)
  } finally {
    panelLoading.value = false
  }
}

async function enterRows(table: string) {
  currentTable.value = table
  rowsPage.value = 1
  dbView.value = 'rows'
  await loadRows()
}

async function loadRows() {
  if (!serverStore.currentId) return
  panelLoading.value = true
  try {
    const data = await tableRows(serverStore.currentId!, currentDb.value, currentTable.value, rowsPage.value, 10)
    rowsColumns.value = data.columns
    rowObjects.value = zip(data.columns, data.rows)
    rowsTotal.value = data.total
  } finally {
    panelLoading.value = false
  }
}

async function onExecSql() {
  const sql = sqlText.value.trim()
  if (!sql) {
    ElMessage.warning('请输入 SQL')
    return
  }
  const head = sql.toLowerCase()
  const isWrite = /^(insert|update|delete|create|alter|drop|truncate|rename|grant|revoke|flush)\b/.test(head)
  if (isWrite) {
    await ElMessageBox.confirm(`执行写操作 SQL：\n${sql.slice(0, 200)}`, 'SQL 确认', { type: 'warning', confirmButtonText: '执行' })
  }
  sqlRunning.value = true
  try {
    const result = await execSql(serverStore.currentId!, currentDb.value, sql, isWrite)
    sqlResult.value = result
    sqlResultRows.value = zip(result.columns, result.rows)
  } finally {
    sqlRunning.value = false
  }
}

// ===== Redis =====
const redisInfo = ref<RedisInfo | null>(null)
const redisKeys = ref<Array<{ key: string }>>([])
const redisLoading = ref(false)
const redisUnavailable = ref(false)
const redisMessage = ref('')

const memText = computed(() => {
  const m = redisInfo.value?.usedMemory
  return m === undefined ? '--' : m >= 1048576 ? `${(m / 1048576).toFixed(1)} MB` : `${Math.round(m / 1024)} KB`
})

async function loadRedis() {
  if (!serverStore.currentId) return
  redisLoading.value = true
  try {
    const info = await getRedisInfo(serverStore.currentId)
    if (!info.available) {
      redisUnavailable.value = true
      redisMessage.value = info.message || 'Redis 未安装或未运行'
      redisInfo.value = null
      redisKeys.value = []
      return
    }
    redisUnavailable.value = false
    redisInfo.value = info
    const keys = await listRedisKeys(serverStore.currentId)
    if (keys.available) {
      redisKeys.value = (keys.keys || []).map((key) => ({ key }))
    }
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
.toolbar { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
.hint { font-size: 12px; color: #909399; }
.alert-gap { margin-bottom: 16px; }
.row-gap { margin-top: 16px; }
.page-header { margin-bottom: 16px; }
.table-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 20px; font-weight: 600; }
}
.redis-header { display: flex; justify-content: space-between; align-items: center; }
</style>
