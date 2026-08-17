import request from './request'

export interface StoreItem {
  name: string
  display: string
  desc: string
  installed: boolean
  version: string
  package: string
  type?: 'plain' | 'php' | 'java' | 'composer' | 'supervisor' | 'disk'
  versions?: string[]
  defaultVersion?: string
  fpm?: string
}

export function listStore(serverId: string) {
  return request.get(`/servers/${serverId}/store`) as Promise<StoreItem[]>
}

export function installSoftware(serverId: string, name: string, version?: string) {
  return request.post(`/servers/${serverId}/store/${name}/install`, version ? { version } : {})
}

export function switchJava(serverId: string, version: string) {
  return request.post(`/servers/${serverId}/store/java/switch`, { version })
}
