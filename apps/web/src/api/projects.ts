import request from './request'

export interface Project {
  name: string
  type: 'php' | 'node' | 'python' | 'java'
  directory: string
  port: number
  entry: string
  phpVersion?: string
  status: string
  createdAt: string
}

export interface ProjectPayload {
  name: string
  type: string
  directory: string
  port: number
  entry?: string
  phpVersion?: string
}

export function listProjects(serverId: string) {
  return request.get(`/servers/${serverId}/projects`) as Promise<Project[]>
}

export function createProject(serverId: string, payload: ProjectPayload) {
  return request.post(`/servers/${serverId}/projects`, payload) as Promise<Project>
}

export function controlProject(serverId: string, name: string, action: 'start' | 'stop' | 'restart') {
  return request.post(`/servers/${serverId}/projects/${name}/${action}`)
}

export function deleteProject(serverId: string, name: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/projects/${name}`, { data: { confirm } })
}

export function getProjectLogs(serverId: string, name: string) {
  return request.get(`/servers/${serverId}/projects/${name}/logs`) as Promise<string>
}
