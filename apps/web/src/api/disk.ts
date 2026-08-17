import request from './request'

export interface DiskInfo {
  name: string
  size: string
  type: string
  partitions: Array<{ name: string; size: string; type: string; mount: string }>
}

export interface MountInfo {
  fs: string
  size: string
  used: string
  avail: string
  percent: number
  mount: string
}

export function getDisk(serverId: string) {
  return request.get(`/servers/${serverId}/disk`) as Promise<{ disks: DiskInfo[]; mounts: MountInfo[] }>
}

export function mountDevice(serverId: string, payload: { device: string; mountPoint: string }) {
  return request.post(`/servers/${serverId}/disk/mount`, payload)
}

export function umountDevice(serverId: string, mountPoint: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/disk/umount`, { mountPoint, confirm })
}
