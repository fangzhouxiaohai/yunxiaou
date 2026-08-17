import request from './request'

export interface CrontabEntry {
  line: string
  ours: boolean
  id?: string
}

export function listCrontabs(serverId: string) {
  return request.get(`/servers/${serverId}/crontabs`) as Promise<CrontabEntry[]>
}

export function createCrontab(
  serverId: string,
  payload: {
    expression: string
    type?: 'shell' | 'url' | 'python'
    command?: string
    method?: 'GET' | 'POST'
    url?: string
    postData?: string
    scriptPath?: string
  }
) {
  return request.post(`/servers/${serverId}/crontabs`, payload)
}

export function deleteCrontab(serverId: string, id: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/crontabs/${id}`, { data: { confirm } })
}
