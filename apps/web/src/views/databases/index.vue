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
    <el-tab-pane label="MySQL" name="mysql">
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
          <el-button @click="openRootPwd">Root 密码</el-button>
          <span class="hint">点击「进入」查看表与数据</span>
        </div>
        <el-table :data="databases" v-loading="dbLoading">
          <el-table-column prop="name" label="数据库名" />
          <el-table-column label="操作" width="260">
            <template #default="{ row }">
              <el-button link type="primary" @click="enterDb(row.name)">进入</el-button>
              <el-button link type="warning" @click="openRenameDb(row.name)">改名</el-button>
              <el-button link type="danger" @click="onDropDb(row.name)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 表浏览器：左树 + 右侧数据/结构 Tab -->
      <el-card v-else-if="dbView === 'explorer'">
        <el-page-header class="db-page-header" @back="dbView = 'list'">
          <template #content>{{ currentDb }}</template>
          <template #extra>
            <el-button type="primary" size="small" @click="openCreateTable">创建表</el-button>
            <el-button type="primary" size="small" plain @click="dbView = 'sql'">SQL</el-button>
            <el-button size="small" @click="loadTables">刷新</el-button>
          </template>
        </el-page-header>
        <div class="explorer">
          <div class="explorer-tree">
            <el-tree
              :data="tables"
              node-key="name"
              :props="{ label: 'name' }"
              highlight-current
              v-loading="tablesLoading"
              @node-click="onSelectTable"
            >
              <template #default="{ data }">
                <div class="tree-node">
                  <span class="tree-label" :title="data.name">{{ data.name }}</span>
                  <span v-if="data.comment" class="tree-comment" :title="data.comment">（{{ data.comment }}）</span>
                  <span class="tree-actions">
                    <el-icon title="改名" @click.stop="openRenameTable(data.name)"><EditPen /></el-icon>
                    <el-icon title="备注" @click.stop="openTableComment(data.name)"><Memo /></el-icon>
                    <el-icon title="删除" class="danger" @click.stop="onDropTable(data.name)"><Delete /></el-icon>
                  </span>
                </div>
              </template>
            </el-tree>
          </div>
          <div class="explorer-main">
            <template v-if="currentTable">
              <div class="explorer-table-name">
                {{ currentTable }}
                <span v-if="currentTableComment" class="table-comment">（{{ currentTableComment }}）</span>
              </div>
              <el-tabs v-model="tableTab">
                <el-tab-pane label="数据" name="data">
                  <div class="toolbar">
                    <el-button type="primary" size="small" @click="openRowDialog('add')">新增行</el-button>
                    <el-button size="small" @click="loadRows">刷新</el-button>
                    <span class="hint">共 {{ rowsTotal }} 行</span>
                  </div>
                  <el-table :data="rowObjects" v-loading="panelLoading" border size="small" max-height="460">
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
                </el-tab-pane>
                <el-tab-pane label="结构" name="structure" lazy>
                  <div class="toolbar">
                    <el-button type="primary" size="small" @click="openFieldDialog('add')">添加字段</el-button>
                    <el-button size="small" @click="loadStructure">刷新</el-button>
                  </div>
                  <el-table :data="structureRows" v-loading="panelLoading" border size="small" max-height="460">
                    <el-table-column v-for="col in structureDisplayColumns" :key="col.key" :prop="col.key" :label="col.label" min-width="110" />
                    <el-table-column label="操作" width="140" fixed="right">
                      <template #default="{ row }">
                        <el-button link type="primary" @click="openFieldDialog('edit', row)">修改</el-button>
                        <el-button link type="danger" @click="onDropColumn(row)">删除</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </el-tab-pane>
              </el-tabs>
            </template>
            <el-empty v-else description="点击左侧表名查看数据与结构" />
          </div>
        </div>
      </el-card>

      <!-- SQL 执行 -->
      <el-card v-else-if="dbView === 'sql'">
        <el-page-header class="db-page-header" @back="dbView = 'explorer'">
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

  <!-- 修改库名 -->
  <el-dialog v-model="renameDbVisible" :title="`修改库名 ${renameDbOld}`" width="min(480px, 94vw)">
    <el-alert type="warning" show-icon :closable="false" class="alert-gap"
      title="通过建新库并迁移全部表实现；旧库上单独授权的用户权限不会自动迁移，需要时请在新库重新授权" />
    <el-form label-width="90px">
      <el-form-item label="新库名" required>
        <el-input v-model="renameDbName" placeholder="字母/数字/下划线" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="renameDbVisible = false">取消</el-button>
      <el-button type="warning" :loading="renameDbSaving" @click="onRenameDb">确认改名</el-button>
    </template>
  </el-dialog>

  <!-- 库改名迁移进度 -->
  <el-dialog v-model="renameProgressVisible" title="正在迁移数据库" width="min(460px, 92vw)" :close-on-click-modal="false" :show-close="false">
    <div class="rename-progress">
      <el-progress :percentage="Math.floor(renamePercent)" :stroke-width="14" striped striped-flow />
      <div class="rename-stage">{{ renameStage }}</div>
      <div class="hint">迁移期间请勿关闭页面，大库可能需要数分钟</div>
    </div>
  </el-dialog>

  <!-- 修改表名 -->
  <el-dialog v-model="renameTableVisible" :title="`修改表名 ${renameTableOld}`" width="min(480px, 94vw)">
    <el-form label-width="90px">
      <el-form-item label="新表名" required>
        <el-input v-model="renameTableName" placeholder="字母/数字/下划线" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="renameTableVisible = false">取消</el-button>
      <el-button type="primary" :loading="renameTableSaving" @click="onRenameTable">保存</el-button>
    </template>
  </el-dialog>

  <!-- 表备注 -->
  <el-dialog v-model="commentVisible" :title="`表备注 ${commentTable}`" width="min(480px, 94vw)">
    <el-input v-model="commentText" type="textarea" :rows="3" maxlength="2048" show-word-limit placeholder="留空则清除备注" />
    <template #footer>
      <el-button @click="commentVisible = false">取消</el-button>
      <el-button type="primary" :loading="commentSaving" @click="onSaveComment">保存</el-button>
    </template>
  </el-dialog>

  <!-- Root 密码 -->
  <el-dialog v-model="rootPwdVisible" title="MySQL Root 密码" width="min(520px, 94vw)">
    <el-form label-width="110px">
      <el-form-item label="当前密码">
        <el-input v-model="rootPwdCurrent" type="password" show-password readonly
          :placeholder="rootPwdConfigured ? '' : '未配置（面板通过 sudo/auth_socket 免密连接）'" />
      </el-form-item>
      <el-form-item label="新密码">
        <div class="root-pwd-row">
          <el-input v-model="rootPwdNew" placeholder="8-64 位，不含引号/反斜杠" show-password type="password" />
          <el-button @click="genRandomPwd">随机生成</el-button>
        </div>
      </el-form-item>
    </el-form>
    <el-alert type="warning" show-icon :closable="false"
      title="重置后立即生效，面板会同步更新保存的凭据；请自行记录新密码，使用旧密码的其他程序将连接失败" />
    <template #footer>
      <el-button @click="rootPwdVisible = false">关闭</el-button>
      <el-button type="danger" :loading="rootPwdSaving" @click="onResetRootPwd">重置密码</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, Memo } from '@element-plus/icons-vue'
import {
  createDatabase, dropDatabase, execSql, flushRedis, getRedisInfo, listDatabases, listRedisKeys,
  listTables, tableRows, tableStructure, createTable, dropTable, addColumn, modifyColumn, dropColumn,
  insertRow, updateRow, deleteRow, renameDatabase, renameTable, getTableComment, setTableComment,
  getRootPassword, resetRootPassword,
  type BatchResult, type RedisInfo, type ColumnDef, type TableInfo,
} from '@/api/database'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('mysql')

// 耗时操作的统一全屏加载圈，避免界面看似无反应
function fullLoading(text: string) {
  return ElLoading.service({ fullscreen: true, text, background: 'rgba(0, 0, 0, 0.35)' })
}

const COLUMN_TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'varchar', 'char', 'text', 'mediumtext', 'longtext', 'decimal', 'float', 'double', 'datetime', 'date', 'time', 'timestamp', 'json']

// ===== MySQL 面板 =====
type DbView = 'list' | 'explorer' | 'sql'
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
const tables = ref<TableInfo[]>([])
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
  currentTable.value = ''
  tableTab.value = 'data'
  dbView.value = 'explorer'
  loadTables()
}

// ===== 表浏览器（左树 + 右侧 Tab）=====
const tableTab = ref<'data' | 'structure'>('data')
const currentTableComment = computed(() => tables.value.find((t) => t.name === currentTable.value)?.comment || '')

// 结构 Tab 展示列：英文键 → 中文表头（SHOW FULL COLUMNS 输出，只挑这几列）
const STRUCTURE_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'Field', label: '字段' },
  { key: 'Type', label: '类型' },
  { key: 'Null', label: '允许NULL' },
  { key: 'Key', label: '键' },
  { key: 'Default', label: '默认值' },
  { key: 'Extra', label: '额外' },
  { key: 'Comment', label: '注释' },
]
const structureDisplayColumns = computed(() => STRUCTURE_COLUMNS.filter((c) => structure.value.columns.includes(c.key)))

async function onSelectTable(data: { name: string }) {
  if (currentTable.value === data.name) return
  currentTable.value = data.name
  rowsPage.value = 1
  tableTab.value = 'data'
  // 行编辑需要字段列表，提前加载结构
  loadStructure()
  await loadRows()
}

async function loadStructure() {
  if (!serverStore.currentId || !currentTable.value) return
  panelLoading.value = true
  try {
    structure.value = await tableStructure(serverStore.currentId, currentDb.value, currentTable.value)
    structureRows.value = zip(structure.value.columns, structure.value.rows)
  } finally {
    panelLoading.value = false
  }
}

watch(tableTab, (tab) => {
  if (tab === 'structure' && currentTable.value) loadStructure()
})

async function loadTables() {
  if (!serverStore.currentId) return
  tablesLoading.value = true
  try {
    tables.value = await listTables(serverStore.currentId, currentDb.value)
  } finally {
    tablesLoading.value = false
  }
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
  const loading = fullLoading('正在删除表...')
  try {
    await dropTable(serverStore.currentId!, currentDb.value, name, true)
    ElMessage.success('已删除')
    if (currentTable.value === name) currentTable.value = ''
    loadTables()
  } finally {
    loading.close()
  }
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
    fieldForm.comment = row.Comment || ''
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
    loadStructure()
  } finally {
    fieldSaving.value = false
  }
}

async function onDropColumn(row: Record<string, string>) {
  await ElMessageBox.confirm(`将删除字段「${row.Field}」，该操作不可恢复。`, '删除字段', { type: 'warning' })
  const loading = fullLoading('正在删除字段...')
  try {
    await dropColumn(serverStore.currentId!, currentDb.value, currentTable.value, row.Field, true)
    ElMessage.success('已删除')
    loadStructure()
  } finally {
    loading.close()
  }
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
  const loading = fullLoading('正在删除行...')
  try {
    await deleteRow(serverStore.currentId!, currentDb.value, currentTable.value, { ...row }, true)
    ElMessage.success('已删除')
    loadRows()
  } finally {
    loading.close()
  }
}

// ===== Root 密码 =====
const rootPwdVisible = ref(false)
const rootPwdSaving = ref(false)
const rootPwdConfigured = ref(false)
const rootPwdCurrent = ref('')
const rootPwdNew = ref('')

async function openRootPwd() {
  rootPwdNew.value = ''
  rootPwdCurrent.value = ''
  rootPwdConfigured.value = false
  rootPwdVisible.value = true
  try {
    const res = await getRootPassword(serverStore.currentId!)
    rootPwdConfigured.value = res.configured
    rootPwdCurrent.value = res.password || ''
  } catch { /* 读取失败仍可执行重置 */ }
}

// 15 位大小写字母+数字随机密码（crypto 安全随机）
function genRandomPwd() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(15)
  crypto.getRandomValues(buf)
  rootPwdNew.value = [...buf].map((n) => chars[n % chars.length]).join('')
}

async function onResetRootPwd() {
  const pwd = rootPwdNew.value.trim()
  if (pwd.length < 8 || pwd.length > 64) {
    ElMessage.warning('密码长度需在 8-64 位之间')
    return
  }
  await ElMessageBox.confirm(`确定将 root 密码重置为：\n${pwd}\n\n重置后旧密码立即失效。`, '重置 Root 密码', { type: 'warning', confirmButtonText: '确认重置' })
  rootPwdSaving.value = true
  try {
    await resetRootPassword(serverStore.currentId!, pwd, true)
    rootPwdCurrent.value = pwd
    rootPwdConfigured.value = true
    rootPwdNew.value = ''
    ElMessage.success('已重置，面板凭据已同步更新')
  } finally {
    rootPwdSaving.value = false
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
  const loading = fullLoading('正在备份并删除数据库，大库可能需要数分钟...')
  try {
    await dropDatabase(serverStore.currentId!, name, true)
    ElMessage.success('已删除（备份在服务器 /tmp/linuxmgr-db-backup/）')
    loadDatabases()
  } finally {
    loading.close()
  }
}

// ===== 修改库名 / 表名 / 表备注 =====
const renameDbVisible = ref(false)
const renameDbSaving = ref(false)
const renameDbOld = ref('')
const renameDbName = ref('')

// 迁移进度弹窗：后端是单次请求，前端按阶段模拟推进，避免界面看似卡死
const renameProgressVisible = ref(false)
const renamePercent = ref(0)
const renameStage = ref('')
const RENAME_STAGES = ['读取旧库表结构', '创建新数据库', '迁移全部表', '删除旧库', '完成']
let renameTimer: ReturnType<typeof setInterval> | undefined

function startRenameProgress() {
  renamePercent.value = 0
  renameStage.value = RENAME_STAGES[0]
  renameProgressVisible.value = true
  const caps = [15, 30, 85, 92]
  renameTimer = setInterval(() => {
    const p = renamePercent.value
    const stageIdx = p < 15 ? 0 : p < 30 ? 1 : p < 85 ? 2 : 3
    renameStage.value = RENAME_STAGES[stageIdx]
    if (p < caps[stageIdx]) renamePercent.value = Math.min(caps[stageIdx], p + Math.random() * 2)
  }, 200)
}

function finishRenameProgress(ok: boolean) {
  if (renameTimer) clearInterval(renameTimer)
  renameTimer = undefined
  if (ok) {
    renamePercent.value = 100
    renameStage.value = RENAME_STAGES[4]
    setTimeout(() => { renameProgressVisible.value = false }, 600)
  } else {
    renameProgressVisible.value = false
  }
}

function openRenameDb(name: string) {
  renameDbOld.value = name
  renameDbName.value = ''
  renameDbVisible.value = true
}

async function onRenameDb() {
  const newName = renameDbName.value.trim()
  if (!newName) {
    ElMessage.warning('请填写新库名')
    return
  }
  renameDbVisible.value = false
  startRenameProgress()
  try {
    const res = await renameDatabase(serverStore.currentId!, renameDbOld.value, newName, true) as unknown as { renamed: string; tables: number }
    finishRenameProgress(true)
    ElMessage.success(`已改名为 ${res.renamed}（迁移 ${res.tables} 张表）`)
    loadDatabases()
  } catch (err) {
    finishRenameProgress(false)
    throw err
  }
}

const renameTableVisible = ref(false)
const renameTableSaving = ref(false)
const renameTableOld = ref('')
const renameTableName = ref('')

function openRenameTable(name: string) {
  renameTableOld.value = name
  renameTableName.value = ''
  renameTableVisible.value = true
}

async function onRenameTable() {
  const newName = renameTableName.value.trim()
  if (!newName) {
    ElMessage.warning('请填写新表名')
    return
  }
  renameTableSaving.value = true
  try {
    await renameTable(serverStore.currentId!, currentDb.value, renameTableOld.value, newName)
    ElMessage.success('已改名')
    renameTableVisible.value = false
    loadTables()
  } finally {
    renameTableSaving.value = false
  }
}

const commentVisible = ref(false)
const commentSaving = ref(false)
const commentTable = ref('')
const commentText = ref('')

async function openTableComment(name: string) {
  commentTable.value = name
  commentText.value = ''
  commentVisible.value = true
  try {
    const res = await getTableComment(serverStore.currentId!, currentDb.value, name)
    commentText.value = res.comment || ''
  } catch { /* 读取失败则留空，仍可填写保存 */ }
}

async function onSaveComment() {
  commentSaving.value = true
  try {
    await setTableComment(serverStore.currentId!, currentDb.value, commentTable.value, commentText.value)
    const row = tables.value.find((t) => t.name === commentTable.value)
    if (row) row.comment = commentText.value
    ElMessage.success('已保存')
    commentVisible.value = false
  } finally {
    commentSaving.value = false
  }
}

async function onFlushRedis() {
  await ElMessageBox.confirm('将清空当前 Redis 库的所有键，不可恢复。', '清空 Redis', { type: 'warning' })
  const loading = fullLoading('正在清空 Redis...')
  try {
    await flushRedis(serverStore.currentId!, true)
    ElMessage.success('已清空')
    loadRedis()
  } finally {
    loading.close()
  }
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
.explorer { display: flex; gap: 16px; align-items: stretch; }
.explorer-tree {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, #e4e7ed);
  padding-right: 8px;
  max-height: 560px;
  overflow-y: auto;
}
.explorer-main { flex: 1; min-width: 0; }
.explorer-table-name { font-size: 15px; font-weight: 600; margin-bottom: 4px; color: var(--text-1, #303133); }
.table-comment { font-size: 13px; font-weight: 400; color: var(--text-3, #909399); }
.tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 4px;
  .tree-label { flex-shrink: 0; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-comment { flex: 1; min-width: 0; font-size: 12px; color: var(--text-3, #909399); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-actions {
    display: none;
    gap: 6px;
    flex-shrink: 0;
    .el-icon { color: #909399; &:hover { color: var(--el-color-primary); } }
    .el-icon.danger:hover { color: var(--el-color-danger); }
  }
  &:hover .tree-actions { display: inline-flex; }
}
.root-pwd-row { display: flex; gap: 8px; width: 100%; }
.rename-progress {
  text-align: center;
  .rename-stage { margin-top: 14px; font-size: 14px; font-weight: 600; color: var(--text-1, #303133); }
  .hint { margin-top: 8px; }
}
@media (max-width: 767px) {
  .explorer { flex-direction: column; }
  .explorer-tree { width: 100%; border-right: none; border-bottom: 1px solid var(--border-color, #e4e7ed); max-height: 240px; padding-right: 0; }
}
</style>
