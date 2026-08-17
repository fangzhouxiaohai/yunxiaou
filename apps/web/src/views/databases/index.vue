<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <div class="page-header">
      <span class="page-title">数据库管理</span>
      <div class="page-actions"></div>
    </div>
    <el-tabs v-model="activeTab">
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
        <el-page-header class="db-page-header" @back="dbView = 'list'">
          <template #content>{{ currentDb }} 的表</template>
          <template #extra>
            <el-button type="primary" size="small" @click="openCreateTable">创建表</el-button>
            <el-button type="primary" size="small" plain @click="dbView = 'sql'">SQL</el-button>
            <el-button size="small" @click="loadTables">刷新</el-button>
          </template>
        </el-page-header>
        <el-table :data="tables" v-loading="tablesLoading" class="table-gap">
          <el-table-column prop="name" label="表名" />
          <el-table-column label="操作" width="260">
            <template #default="{ row }">
              <el-button link type="primary" @click="enterStructure(row.name)">结构</el-button>
              <el-button link type="success" @click="enterRows(row.name)">数据</el-button>
              <el-button link type="danger" @click="onDropTable(row.name)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 表结构 -->
      <el-card v-else-if="dbView === 'structure'">
        <el-page-header class="db-page-header" @back="dbView = 'tables'">
          <template #content>{{ currentDb }}.{{ currentTable }} 结构</template>
          <template #extra>
            <el-button type="primary" size="small" @click="openFieldDialog('add')">添加字段</el-button>
            <el-button size="small" @click="enterStructure(currentTable)">刷新</el-button>
          </template>
        </el-page-header>
        <el-table :data="structureRows" v-loading="panelLoading" class="table-gap" border size="small">
          <el-table-column v-for="col in structure.columns" :key="col" :prop="col" :label="col" min-width="110" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openFieldDialog('edit', row)">修改</el-button>
              <el-button link type="danger" @click="onDropColumn(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 数据浏览 -->
      <el-card v-else-if="dbView === 'rows'">
        <el-page-header class="db-page-header" @back="dbView = 'tables'">
          <template #content>{{ currentDb }}.{{ currentTable }} 数据（共 {{ rowsTotal }} 行）</template>
          <template #extra>
            <el-button type="primary" size="small" @click="openRowDialog('add')">新增行</el-button>
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
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openRowDialog('edit', row)">编辑</el-button>
              <el-button link type="danger" @click="onDeleteRow(row)">删除</el-button>
            </template>
          </el-table-column>
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
        <el-page-header class="db-page-header" @back="dbView = 'tables'">
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
        <el-col :xs="24" :sm="12" :lg="6"><el-card><div class="stat"><div class="label">版本</div><div class="value">{{ redisInfo?.version || '--' }}</div></div></el-card></el-col>
        <el-col :xs="24" :sm="12" :lg="6"><el-card><div class="stat"><div class="label">内存占用</div><div class="value">{{ memText }}</div></div></el-card></el-col>
        <el-col :xs="24" :sm="12" :lg="6"><el-card><div class="stat"><div class="label">连接数</div><div class="value">{{ redisInfo?.connectedClients ?? '--' }}</div></div></el-card></el-col>
        <el-col :xs="24" :sm="12" :lg="6"><el-card><div class="stat"><div class="label">命中率</div><div class="value">{{ redisInfo ? redisInfo.hitRate + '%' : '--' }}</div></div></el-card></el-col>
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
  </div>

  <el-dialog v-model="dbDialogVisible" title="创建数据库" width="min(440px, 92vw)">
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

  <!-- 创建表 -->
  <el-dialog v-model="tableDialogVisible" title="创建表" width="min(960px, 96vw)" top="4vh">
    <el-form label-width="90px">
      <el-row :gutter="12">
        <el-col :xs="24" :sm="8">
          <el-form-item label="表名" required>
            <el-input v-model="tableForm.table" placeholder="字母/数字/下划线" />
          </el-form-item>
        </el-col>
        <el-col :xs="12" :sm="5">
          <el-form-item label="存储引擎">
            <el-select v-model="tableForm.engine">
              <el-option label="InnoDB" value="InnoDB" />
              <el-option label="MyISAM" value="MyISAM" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="12" :sm="5">
          <el-form-item label="字符集">
            <el-select v-model="tableForm.charset">
              <el-option label="utf8mb4" value="utf8mb4" />
              <el-option label="utf8" value="utf8" />
              <el-option label="gbk" value="gbk" />
              <el-option label="latin1" value="latin1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="6">
          <el-form-item label="表注释">
            <el-input v-model="tableForm.comment" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
    <el-table :data="tableForm.columns" border size="small">
      <el-table-column label="字段名" min-width="130">
        <template #default="{ row }"><el-input v-model="row.name" size="small" placeholder="必填" /></template>
      </el-table-column>
      <el-table-column label="类型" width="130">
        <template #default="{ row }">
          <el-select v-model="row.type" size="small">
            <el-option v-for="t in COLUMN_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="长度" width="90">
        <template #default="{ row }"><el-input v-model="row.length" size="small" placeholder="如 200" /></template>
      </el-table-column>
      <el-table-column label="允许 NULL" width="86" align="center">
        <template #default="{ row }"><el-checkbox v-model="row.nullable" /></template>
      </el-table-column>
      <el-table-column label="主键" width="62" align="center">
        <template #default="{ row }"><el-checkbox v-model="row.primary" /></template>
      </el-table-column>
      <el-table-column label="自增" width="62" align="center">
        <template #default="{ row }"><el-checkbox v-model="row.autoIncrement" /></template>
      </el-table-column>
      <el-table-column label="默认值" min-width="100">
        <template #default="{ row }"><el-input v-model="row.defaultValue" size="small" /></template>
      </el-table-column>
      <el-table-column label="注释" min-width="100">
        <template #default="{ row }"><el-input v-model="row.comment" size="small" /></template>
      </el-table-column>
      <el-table-column label="" width="60" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="tableForm.columns.splice($index, 1)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button class="table-gap" size="small" @click="addTableColumn">添加字段</el-button>
    <template #footer>
      <el-button @click="tableDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="tableSaving" @click="onCreateTable">创建</el-button>
    </template>
  </el-dialog>

  <!-- 添加/修改字段 -->
  <el-dialog v-model="fieldDialogVisible" :title="fieldMode === 'add' ? '添加字段' : `修改字段 ${fieldForm.oldName}`" width="min(560px, 94vw)">
    <el-form label-width="100px">
      <el-form-item label="字段名" required>
        <el-input v-model="fieldForm.name" />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="类型">
            <el-select v-model="fieldForm.type" style="width: 100%">
              <el-option v-for="t in COLUMN_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="长度">
            <el-input v-model="fieldForm.length" placeholder="varchar 必填" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="允许 NULL">
        <el-checkbox v-model="fieldForm.nullable" />
      </el-form-item>
      <el-form-item label="默认值">
        <el-input v-model="fieldForm.defaultValue" placeholder="留空则不设默认值" />
      </el-form-item>
      <el-form-item label="注释">
        <el-input v-model="fieldForm.comment" />
      </el-form-item>
      <el-form-item v-if="fieldMode === 'add'" label="位置">
        <el-select v-model="fieldForm.after" clearable placeholder="默认追加到末尾" style="width: 100%">
          <el-option v-for="f in structureRows" :key="f.Field" :label="`在 ${f.Field} 之后`" :value="f.Field" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="fieldDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="fieldSaving" @click="onSaveField">保存</el-button>
    </template>
  </el-dialog>

  <!-- 新增/编辑行 -->
  <el-dialog v-model="rowDialogVisible" :title="rowMode === 'add' ? '新增行' : '编辑行'" width="min(640px, 94vw)">
    <el-form label-width="140px" class="row-form">
      <el-form-item v-for="col in rowsColumns" :key="col" :label="col">
        <div class="row-field">
          <el-input v-model="rowForm[col]" :disabled="rowNulls[col]" :placeholder="rowNulls[col] ? 'NULL' : ''" />
          <el-checkbox v-model="rowNulls[col]" class="null-check">NULL</el-checkbox>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="rowDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="rowSaving" @click="onSaveRow">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createDatabase, dropDatabase, execSql, flushRedis, getRedisInfo, listDatabases, listRedisKeys,
  listTables, tableRows, tableStructure, createTable, dropTable, addColumn, modifyColumn, dropColumn,
  insertRow, updateRow, deleteRow, type BatchResult, type RedisInfo, type ColumnDef,
} from '@/api/database'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('mysql')

const COLUMN_TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'varchar', 'char', 'text', 'mediumtext', 'longtext', 'decimal', 'float', 'double', 'datetime', 'date', 'time', 'timestamp', 'json']

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
  // 行编辑需要字段列表
  if (structureRows.value.length === 0 || structure.value.columns.length === 0) {
    try {
      structure.value = await tableStructure(serverStore.currentId!, currentDb.value, table)
      structureRows.value = zip(structure.value.columns, structure.value.rows)
    } catch { /* 结构加载失败不阻塞数据浏览 */ }
  }
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

// ===== 创建表 =====
const tableDialogVisible = ref(false)
const tableSaving = ref(false)
interface EditableColumn extends ColumnDef { name: string }
const tableForm = reactive({
  table: '',
  engine: 'InnoDB',
  charset: 'utf8mb4',
  comment: '',
  columns: [] as EditableColumn[],
})

function newColumn(): EditableColumn {
  return { name: '', type: 'varchar', length: '', nullable: false, primary: false, autoIncrement: false, defaultValue: '', comment: '' }
}

function addTableColumn() {
  tableForm.columns.push(newColumn())
}

function openCreateTable() {
  tableForm.table = ''
  tableForm.comment = ''
  tableForm.columns = [
    { name: 'id', type: 'int', length: '', nullable: false, primary: true, autoIncrement: true, defaultValue: '', comment: '' },
    newColumn(),
  ]
  tableDialogVisible.value = true
}

async function onCreateTable() {
  if (!tableForm.table) {
    ElMessage.warning('请填写表名')
    return
  }
  const columns = tableForm.columns.filter((c) => c.name.trim())
  if (columns.length === 0) {
    ElMessage.warning('至少需要一个字段')
    return
  }
  tableSaving.value = true
  try {
    await createTable(serverStore.currentId!, currentDb.value, {
      table: tableForm.table.trim(),
      engine: tableForm.engine,
      charset: tableForm.charset,
      comment: tableForm.comment || undefined,
      columns: columns.map((c) => ({ ...c, name: c.name.trim(), length: c.length || undefined, defaultValue: c.defaultValue || undefined, comment: c.comment || undefined })),
    })
    ElMessage.success('创建成功')
    tableDialogVisible.value = false
    loadTables()
  } finally {
    tableSaving.value = false
  }
}

async function onDropTable(name: string) {
  await ElMessageBox.confirm(`将删除表「${name}」，该操作不可恢复。`, '删除表', { type: 'warning' })
  await dropTable(serverStore.currentId!, currentDb.value, name, true)
  ElMessage.success('已删除')
  loadTables()
}

// ===== 字段管理 =====
const fieldDialogVisible = ref(false)
const fieldSaving = ref(false)
const fieldMode = ref<'add' | 'edit'>('add')
const fieldForm = reactive({
  oldName: '',
  name: '',
  type: 'varchar',
  length: '',
  nullable: false,
  defaultValue: '',
  comment: '',
  after: '',
})

function parseType(t: string): { type: string; length: string } {
  const m = /^(\w+)(?:\(([^)]+)\))?/.exec(t || '')
  if (!m) return { type: 'varchar', length: '' }
  return { type: m[1].toLowerCase(), length: m[2] || '' }
}

function openFieldDialog(mode: 'add' | 'edit', row?: Record<string, string>) {
  fieldMode.value = mode
  if (mode === 'edit' && row) {
    const { type, length } = parseType(row.Type)
    fieldForm.oldName = row.Field
    fieldForm.name = row.Field
    fieldForm.type = COLUMN_TYPES.includes(type) ? type : 'varchar'
    fieldForm.length = length
    fieldForm.nullable = row.Null === 'YES'
    fieldForm.defaultValue = row.Default === 'NULL' ? '' : (row.Default || '')
    fieldForm.comment = ''
    fieldForm.after = ''
  } else {
    fieldForm.oldName = ''
    fieldForm.name = ''
    fieldForm.type = 'varchar'
    fieldForm.length = ''
    fieldForm.nullable = false
    fieldForm.defaultValue = ''
    fieldForm.comment = ''
    fieldForm.after = ''
  }
  fieldDialogVisible.value = true
}

async function onSaveField() {
  if (!fieldForm.name.trim()) {
    ElMessage.warning('请填写字段名')
    return
  }
  const column: ColumnDef = {
    name: fieldForm.name.trim(),
    type: fieldForm.type,
    length: fieldForm.length || undefined,
    nullable: fieldForm.nullable,
    defaultValue: fieldForm.defaultValue || undefined,
    comment: fieldForm.comment || undefined,
  }
  fieldSaving.value = true
  try {
    if (fieldMode.value === 'add') {
      await addColumn(serverStore.currentId!, currentDb.value, currentTable.value, { column, after: fieldForm.after || undefined })
    } else {
      await modifyColumn(serverStore.currentId!, currentDb.value, currentTable.value, fieldForm.oldName, { column })
    }
    ElMessage.success('已保存')
    fieldDialogVisible.value = false
    enterStructure(currentTable.value)
  } finally {
    fieldSaving.value = false
  }
}

async function onDropColumn(row: Record<string, string>) {
  await ElMessageBox.confirm(`将删除字段「${row.Field}」，该操作不可恢复。`, '删除字段', { type: 'warning' })
  await dropColumn(serverStore.currentId!, currentDb.value, currentTable.value, row.Field, true)
  ElMessage.success('已删除')
  enterStructure(currentTable.value)
}

// ===== 行编辑 =====
const rowDialogVisible = ref(false)
const rowSaving = ref(false)
const rowMode = ref<'add' | 'edit'>('add')
const rowForm = reactive<Record<string, string>>({})
const rowNulls = reactive<Record<string, boolean>>({})
let rowOriginal: Record<string, string> | null = null

function openRowDialog(mode: 'add' | 'edit', row?: Record<string, string>) {
  rowMode.value = mode
  rowOriginal = mode === 'edit' && row ? { ...row } : null
  for (const col of rowsColumns.value) {
    rowForm[col] = mode === 'edit' && row ? (row[col] ?? '') : ''
    rowNulls[col] = false
  }
  rowDialogVisible.value = true
}

async function onSaveRow() {
  const data: Record<string, string | null> = {}
  for (const col of rowsColumns.value) {
    data[col] = rowNulls[col] ? null : rowForm[col]
  }
  rowSaving.value = true
  try {
    if (rowMode.value === 'add') {
      await insertRow(serverStore.currentId!, currentDb.value, currentTable.value, data)
    } else {
      await updateRow(serverStore.currentId!, currentDb.value, currentTable.value, { ...(rowOriginal || {}) }, data)
    }
    ElMessage.success('已保存')
    rowDialogVisible.value = false
    loadRows()
  } finally {
    rowSaving.value = false
  }
}

async function onDeleteRow(row: Record<string, string>) {
  await ElMessageBox.confirm('将删除该行数据，不可恢复。', '删除行', { type: 'warning' })
  await deleteRow(serverStore.currentId!, currentDb.value, currentTable.value, { ...row }, true)
  ElMessage.success('已删除')
  loadRows()
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
.db-page-header { margin-bottom: 16px; }
.table-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 20px; font-weight: 600; }
}
.redis-header { display: flex; justify-content: space-between; align-items: center; }
.row-form { max-height: 60vh; overflow-y: auto; }
.row-field { display: flex; align-items: center; gap: 12px; width: 100%; }
.null-check { flex-shrink: 0; }
</style>
