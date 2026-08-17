import request from './request'

export interface DbListResult {
  available: boolean
  databases?: Array<{ name: string; comment: string }>
  message?: string
}

export interface RedisInfo {
  available: boolean
  message?: string
  version: string
  mode: string
  connectedClients: number
  usedMemory: number
  totalConnections: number
  totalCommands: number
  hitRate: number
  totalKeys: number
  databases: Array<{ db: string; keys: number; expires: number }>
}

export interface RedisKeysResult {
  available: boolean
  keys?: string[]
  message?: string
}

export function listDatabases(serverId: string) {
  return request.get(`/servers/${serverId}/databases`) as Promise<DbListResult>
}

export function createDatabase(serverId: string, payload: { name: string; username: string; password: string }) {
  return request.post(`/servers/${serverId}/databases`, payload)
}

export function dropDatabase(serverId: string, name: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/databases/${name}`, { data: { confirm } })
}

export function renameDatabase(serverId: string, name: string, newName: string, confirm: boolean) {
  // 大库迁移可能较慢，放宽超时与后端 120s 对齐
  return request.post(`/servers/${serverId}/databases/${name}/rename`, { newName, confirm }, { timeout: 120000 })
}

export function setDatabaseComment(serverId: string, name: string, comment: string) {
  return request.put(`/servers/${serverId}/databases/${name}/comment`, { comment })
}

export function getRootPassword(serverId: string) {
  return request.get(`/servers/${serverId}/mysql/root-password`) as Promise<{ configured: boolean; password: string | null }>
}

export function resetRootPassword(serverId: string, newPassword: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/mysql/root-password/reset`, { newPassword, confirm })
}

export function getRedisInfo(serverId: string) {
  return request.get(`/servers/${serverId}/redis`) as Promise<RedisInfo>
}

export function listRedisKeys(serverId: string) {
  return request.get(`/servers/${serverId}/redis/keys`) as Promise<RedisKeysResult>
}

export function flushRedis(serverId: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/redis/flush`, { confirm })
}

// ===== 数据库面板=====

export interface BatchResult {
  columns: string[]
  rows: string[][]
}

export interface TableInfo {
  name: string
  comment: string
}

export function listTables(serverId: string, db: string) {
  return request.get(`/servers/${serverId}/databases/${db}/tables`) as Promise<TableInfo[]>
}

export function tableStructure(serverId: string, db: string, table: string) {
  return request.get(`/servers/${serverId}/databases/${db}/tables/${table}/structure`) as Promise<BatchResult>
}

export function tableRows(serverId: string, db: string, table: string, page: number, limit: number) {
  return request.get(`/servers/${serverId}/databases/${db}/tables/${table}/rows`, { params: { page, limit } }) as Promise<
    BatchResult & { total: number; page: number; limit: number }
  >
}

export function execSql(serverId: string, db: string, sql: string, confirm?: boolean) {
  return request.post(`/servers/${serverId}/sql`, { db, sql, confirm }) as Promise<BatchResult>
}

// ===== 表/字段/行管理 =====

export interface ColumnDef {
  name: string
  type: string
  length?: string
  nullable?: boolean
  primary?: boolean
  autoIncrement?: boolean
  defaultValue?: string
  comment?: string
}

export function createTable(serverId: string, db: string, payload: { table: string; columns: ColumnDef[]; engine?: string; charset?: string; comment?: string }) {
  return request.post(`/servers/${serverId}/databases/${db}/tables`, payload)
}

export function dropTable(serverId: string, db: string, table: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/databases/${db}/tables/${table}`, { data: { confirm } })
}

export function renameTable(serverId: string, db: string, table: string, newName: string) {
  return request.post(`/servers/${serverId}/databases/${db}/tables/${table}/rename`, { newName })
}

export function getTableComment(serverId: string, db: string, table: string) {
  return request.get(`/servers/${serverId}/databases/${db}/tables/${table}/comment`) as Promise<{ comment: string }>
}

export function setTableComment(serverId: string, db: string, table: string, comment: string) {
  return request.put(`/servers/${serverId}/databases/${db}/tables/${table}/comment`, { comment })
}

export function addColumn(serverId: string, db: string, table: string, payload: { column: ColumnDef; after?: string }) {
  return request.post(`/servers/${serverId}/databases/${db}/tables/${table}/columns`, payload)
}

export function modifyColumn(serverId: string, db: string, table: string, col: string, payload: { column: ColumnDef }) {
  return request.put(`/servers/${serverId}/databases/${db}/tables/${table}/columns/${col}`, payload)
}

export function dropColumn(serverId: string, db: string, table: string, col: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/databases/${db}/tables/${table}/columns/${col}`, { data: { confirm } })
}

export function insertRow(serverId: string, db: string, table: string, data: Record<string, string | null>) {
  return request.post(`/servers/${serverId}/databases/${db}/tables/${table}/rows`, { data })
}

export function updateRow(serverId: string, db: string, table: string, where: Record<string, string | null>, data: Record<string, string | null>) {
  return request.put(`/servers/${serverId}/databases/${db}/tables/${table}/rows`, { where, data })
}

export function deleteRow(serverId: string, db: string, table: string, where: Record<string, string | null>, confirm: boolean) {
  return request.delete(`/servers/${serverId}/databases/${db}/tables/${table}/rows`, { data: { where, confirm } })
}
