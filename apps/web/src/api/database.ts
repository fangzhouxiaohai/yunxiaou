import request from './request'

export interface DbListResult {
  available: boolean
  databases?: string[]
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

export function getRedisInfo(serverId: string) {
  return request.get(`/servers/${serverId}/redis`) as Promise<RedisInfo>
}

export function listRedisKeys(serverId: string) {
  return request.get(`/servers/${serverId}/redis/keys`) as Promise<RedisKeysResult>
}

export function flushRedis(serverId: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/redis/flush`, { confirm })
}
