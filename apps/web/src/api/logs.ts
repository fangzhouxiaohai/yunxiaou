import request from './request'

export interface LogFile {
  path: string
  exists: boolean
  size: number
}

export function listLogFiles(serverId: string) {
  return request.get(`/servers/${serverId}/logs/files`) as Promise<LogFile[]>
}

export function readLog(serverId: string, path: string, lines: number) {
  return request.get(`/servers/${serverId}/logs/read`, { params: { path, lines } }) as Promise<string>
}
