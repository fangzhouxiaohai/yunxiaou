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
  isDefault?: boolean
}

export function listStore(serverId: string) {
  return request.get(`/servers/${serverId}/store`) as Promise<StoreItem[]>
}

export function installSoftware(serverId: string, name: string, version?: string) {
  return request.post(`/servers/${serverId}/store/${name}/install`, version ? { version } : {})
}

export function uninstallSoftware(serverId: string, name: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/store/${name}/uninstall`, { confirm })
}

export function switchJava(serverId: string, version: string) {
  return request.post(`/servers/${serverId}/store/java/switch`, { version })
}

export function setPhpDefault(serverId: string, version: string) {
  return request.post(`/servers/${serverId}/store/php/default`, { version })
}
