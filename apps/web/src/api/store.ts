import request from './request'

export interface StoreItem {
  name: string
  display: string
  desc: string
  installed: boolean
  version: string
  package: string
}

export function listStore(serverId: string) {
  return request.get(`/servers/${serverId}/store`) as Promise<StoreItem[]>
}

export function installSoftware(serverId: string, name: string) {
  return request.post(`/servers/${serverId}/store/${name}/install`)
}
