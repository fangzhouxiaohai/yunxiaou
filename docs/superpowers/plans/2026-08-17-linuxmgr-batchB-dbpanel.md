# 批次 B：数据库管理面板（phpMyAdmin 风格）实现计划

> 使用 executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。

**目标：** 数据库管理升级为 phpMyAdmin 5.2 风格面板：库列表 → 表列表 → 表结构（DESCRIBE）→ 数据浏览（分页）→ 执行 SQL。

**架构：** 扩展 `server/src/routes/database.js` 增加面板端点（mysql -B batch 输出解析）；前端 `views/databases/index.vue` 重构为视图状态机（库列表/表列表/结构/数据/SQL）。

**约束：** 危险 SQL（DROP/TRUNCATE/DELETE/UPDATE 无 WHERE/ALTER）需 `confirm: true`；表名/库名白名单；SQL 长度 ≤ 10KB；全部走 mysql CLI（sudo 或 root 凭据）。

---

### 任务 B1：数据库面板后端

**文件：**
- 扩展：`server/src/utils/dbParser.js`（parseBatchResult）
- 扩展：`server/src/routes/database.js`（4 个端点 + 危险 SQL 检测）
- 扩展：`server/test/database.test.js`

- [ ] **步骤 1：新增测试**

```js
// dbParser 测试追加
test('解析 mysql -B batch 输出（含表头）', () => {
  const r = parseBatchResult('Field\tType\tNull\tKey\nid\tint\tNO\tPRI\nname\tvarchar(255)\tYES\t\n');
  assert.deepEqual(r.columns, ['Field', 'Type', 'Null', 'Key']);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0][0], 'id');
  assert.equal(r.rows[1][1], 'varchar(255)');
});

// database.test.js 追加（mock pool，mysql -B 输出）
test('表列表', async () => {
  // GET /api/servers/srv1/databases/app_blog/tables
  // scripted 'mysql ... -B -e "SHOW TABLES FROM `app_blog`"' → stdout 'Tables_in_app_blog\nposts\nusers\n'
  // 断言 data 包含 posts
});
test('表结构', async () => {
  // GET /api/servers/srv1/databases/app_blog/tables/posts/structure
  // DESCRIBE 输出 → columns Field/Type/Null/Key/Default/Extra + rows
});
test('数据浏览分页', async () => {
  // GET /api/servers/srv1/databases/app_blog/tables/posts/rows?page=2&limit=10
  // 断言调用包含 LIMIT 10 OFFSET 10 与 SELECT COUNT(*)
});
test('执行只读 SQL', async () => {
  // POST /api/servers/srv1/sql { db: 'app_blog', sql: 'SELECT * FROM posts LIMIT 5' }
  // 200 + 结果列/行
});
test('执行写 SQL 未确认时拒绝', async () => {
  // POST sql { sql: 'DELETE FROM posts WHERE id=1' } 无 confirm → 400
});
test('危险 SQL 无 WHERE 的 DELETE 即使确认也拒绝', async () => {
  // POST sql { sql: 'DELETE FROM posts', confirm: true } → 400（无 WHERE 全表删除拦截）
});
```

- [ ] **步骤 2：运行测试验证失败**
- [ ] **步骤 3：实现**

`dbParser.js` 追加：

```js
function parseBatchResult(output) {
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => l.split('\t'));
  return { columns, rows };
}
```

`database.js` 追加（复用 mysqlCmd/mysqlAuth；batch 模式需要新 helper）：

```js
// mysql -B 输出（带表头 tab 分隔）
function mysqlBatchCmd(server, sql, res) {
  const auth = mysqlAuth(server, res);
  if (auth === null) return null;
  if (auth) return `mysql ${auth} -B -e "${sql}"`;
  return `sudo mysql -B -e "${sql}"`;
}

const TABLE_RE = /^[a-zA-Z0-9_$]{1,64}$/;
const DB_NAME_RE_SAFE = DB_NAME_RE; // 复用

// 危险 SQL 检测：写操作需 confirm；无 WHERE 的 DELETE/UPDATE 直接拦截
function sqlSafety(sql) {
  const s = sql.trim().toLowerCase();
  const isRead = /^(select|show|describe|desc|explain)\b/.test(s);
  const isWrite = /^(insert|update|delete|create|alter|drop|truncate|rename|grant|revoke|flush)\b/.test(s);
  if (!isRead && !isWrite) return { allowed: false, message: '不支持的 SQL 语句' };
  if (isWrite && /^(delete|update)\b/.test(s) && !/\bwhere\b/.test(s)) {
    return { allowed: false, message: '禁止无 WHERE 条件的全表 DELETE/UPDATE' };
  }
  if (isWrite) return { allowed: true, needConfirm: true };
  return { allowed: true, needConfirm: false };
}

// GET /servers/:id/databases/:db/tables — SHOW TABLES FROM `db`
// GET /servers/:id/databases/:db/tables/:table/structure — DESCRIBE `db`.`table`
// GET /servers/:id/databases/:db/tables/:table/rows — SELECT * LIMIT/OFFSET + COUNT(*)
// POST /servers/:id/sql — { db, sql, confirm } — 通用执行
```

rows 端点：两个查询并行（COUNT 与分页 SELECT），返回 { columns, rows, total, page, limit }。列名用 batch 表头。LIMIT/OFFSET 数值校验（int 1-1000 / 0-1e6）。

SQL 执行端点：`sqlSafety` 检查；needConfirm 且 confirm !== true → 400；执行 mysqlBatchCmd → parseBatchResult。审计写操作。

挂载：database 路由已在 /api 下，路径 /servers/:id/databases/:db/... 与现有 /servers/:id/databases（列表）不冲突（:db 是第二段）；注意现有 GET /servers/:id/databases 在前，/databases/:db/tables 不同路径不冲突 ✓。

- [ ] **步骤 4：运行测试验证通过（全量）**
- [ ] **步骤 5：Commit** `feat: 数据库面板后端（表列表/结构/数据分页/SQL 执行）`

---

### 任务 B2：数据库面板前端

**文件：**
- 扩展：`apps/web/src/api/database.ts`
- 重构：`apps/web/src/views/databases/index.vue`

- [ ] **步骤 1：扩展 API**

```ts
export interface BatchResult { columns: string[]; rows: string[][] }
export function listTables(serverId: string, db: string) { return request.get(`/servers/${serverId}/databases/${db}/tables`) as Promise<string[]> }
export function tableStructure(serverId: string, db: string, table: string) { return request.get(`/servers/${serverId}/databases/${db}/tables/${table}/structure`) as Promise<BatchResult> }
export function tableRows(serverId: string, db: string, table: string, page: number, limit: number) { return request.get(`/servers/${serverId}/databases/${db}/tables/${table}/rows`, { params: { page, limit } }) as Promise<{ columns: string[]; rows: string[][]; total: number }> }
export function execSql(serverId: string, db: string, sql: string, confirm?: boolean) { return request.post(`/servers/${serverId}/sql`, { db, sql, confirm }) as Promise<BatchResult> }
```

- [ ] **步骤 2：重构页面（视图状态机）**

MySQL tab 内：
- `view = 'list'`：库列表，行尾「进入」按钮 → `view = 'tables'`, 记录 currentDb；面包屑「库列表 / app_blog」
- `view = 'tables'`：表列表（列：表名 + 行数 hint 可省）+「结构」「数据」按钮 + 「SQL」按钮 → 对应 view
- `view = 'structure'`：DESCRIBE 表格（columns 为表头）+ 返回
- `view = 'rows'`：el-table 动态列（columns 数组映射）+ el-pagination（total/limit 10）+ 刷新
- `view = 'sql'`：el-input type=textarea rows=8 占位 `SELECT * FROM posts LIMIT 100;` + 「执行」按钮（写语句自动弹确认框，基于后端 needConfirm 逻辑前端也预检 DELETE/UPDATE/DROP 等关键词触发 ElMessageBox）+ 结果 el-table
- Redis tab 保持现有（unavailable 提示等）
- 动态列渲染：`<el-table-column v-for="col in columns" :key="col" :prop="col" :label="col" min-width="120" show-overflow-tooltip />`，rows 为对象数组（由 columns zip 转换）或直接用二维数组 + 自定义列模板（`{{ row[colIndex] }}`）。用二维数组 + slot：`<template #default="{ row }"><span>{{ row[colIndex] }}</span></template>` 需要列索引——用 `#default="scope"` 时拿不到索引；改用对象数组：`rows.map(r => Object.fromEntries(columns.map((c,i)=>[c,r[i]])))`。

- [ ] **步骤 3：验证**：`npx vue-tsc -b` 0 错误；浏览器操作流程（真实服务器只读操作）
- [ ] **步骤 4：Commit** `feat: 数据库面板前端（phpMyAdmin 风格视图）`

---

### 任务 B3：真实服务器端到端验证

- [ ] **步骤 1**：重启后端；`GET /api/servers/<id>/databases` 选真实库（bookstore 或 kunlunrenlixiaochengxu，只读）：
  - 表列表、表结构（DESCRIBE）、数据浏览第 1 页、`SELECT * FROM <某表> LIMIT 5` 均返回真实数据
- [ ] **步骤 2**：前端浏览器验证完整流程
- [ ] **步骤 3**：8.1 约束检查（只读命令，零改动）
- [ ] **步骤 4：Commit** `chore: 完成批次 B 端到端验证`

---

## 自检记录
- [ ] 规格覆盖度：批次 B 全部需求（表列表/结构/数据/SQL）有对应任务
- [ ] 无占位符；类型一致性：BatchResult 前后端一致
