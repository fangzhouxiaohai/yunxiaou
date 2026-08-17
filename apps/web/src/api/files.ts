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
  return request.get(`/servers/${serverId}/files`, { params: { path } }) as Promise<{ path: string; items: FileItem[]; error?: string }>
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

export function touchFile(serverId: string, path: string) {
  return request.post(`/servers/${serverId}/files/touch`, { path })
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

export function uploadFiles(
  serverId: string,
  targetPath: string,
  files: File[],
  onProgress?: (percent: number) => void
) {
  const form = new FormData()
  form.append('path', targetPath)
  for (const f of files) {
    form.append('files', f, f.name)
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    form.append('paths', rel)
  }
  return request.post(`/servers/${serverId}/files/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  }) as Promise<{ uploaded: number; targetDir: string }>
}

export function moveFile(serverId: string, path: string, targetDir: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/files/move`, { path, targetDir, confirm })
}

export function copyFile(serverId: string, path: string, targetDir: string) {
  return request.post(`/servers/${serverId}/files/copy`, { path, targetDir })
}
