import request from './request'

export interface Program {
  name: string
  status: string
  pid: string
  uptime: string
}

export function getSupervisor(serverId: string) {
  return request.get(`/servers/${serverId}/supervisor`) as Promise<{ available: boolean; programs: Program[]; message?: string }>
}

export function createProgram(
  serverId: string,
  payload: { name: string; command: string; directory: string; user: string; autostart: boolean }
) {
  return request.post(`/servers/${serverId}/supervisor/programs`, payload)
}

export function deleteProgram(serverId: string, name: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/supervisor/programs/${name}`, { data: { confirm } })
}

export function controlProgram(serverId: string, name: string, action: 'start' | 'stop' | 'restart') {
  return request.post(`/servers/${serverId}/supervisor/programs/${name}/${action}`)
}
