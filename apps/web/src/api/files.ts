import request from './request'

export interface FileItem {
  name: string
  type: 'dir' | 'file' | 'link'
  size: number
  mtime: string
  mode: string
  owner: string
  group: string
}

export function listFiles(serverId: string, path: string) {
  return request.get(`/servers/${serverId}/files`, { params: { path } }) as Promise<{ path: string; items: FileItem[] }>
}

export function readFile(serverId: string, path: string) {
  return request.post(`/servers/${serverId}/files/read`, { path }) as Promise<string>
}

export function writeFile(serverId: string, path: string, content: string) {
  return request.post(`/servers/${serverId}/files/write`, { path, content })
}

export function mkdirFile(serverId: string, path: string) {
  return request.post(`/servers/${serverId}/files/mkdir`, { path })
}

export function deleteFile(serverId: string, path: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/files/delete`, { path, confirm })
}

export function renameFile(serverId: string, path: string, newName: string) {
  return request.post(`/servers/${serverId}/files/rename`, { path, newName })
}

export function chmodFile(serverId: string, path: string, mode: string) {
  return request.post(`/servers/${serverId}/files/chmod`, { path, mode })
}
