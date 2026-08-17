import request from './request'

export interface Project {
  name: string
  type: 'php' | 'node' | 'python' | 'java'
  directory: string
  port: number
  entry: string
  phpVersion?: string
  domain?: string
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
  domain?: string
  rewritePreset?: string
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

export interface SiteSettings {
  domains: string[]
  runDir: string
  index: string
  rewrite: { preset: string; custom?: string }
  antiLeech: { enabled: boolean; allowEmpty: boolean; referers: string[] }
  redirects: { from: string; to: string; type: number }[]
  proxy: { enabled: boolean; target: string }
  access: { allow: string[]; deny: string[] }
  basicAuth: { enabled: boolean; username: string; password?: string }
  customSnippet: string
  sslDomain: string
  phpVersion: string
}

export interface SettingsResult {
  settings: SiteSettings
  phpVersions: string[]
  sslDomain: string
}

export function getProjectSettings(serverId: string, name: string) {
  return request.get(`/servers/${serverId}/projects/${name}/settings`) as Promise<SettingsResult>
}

export function saveProjectSettings(serverId: string, name: string, settings: Partial<SiteSettings>) {
  return request.put(`/servers/${serverId}/projects/${name}/settings`, { settings }) as Promise<{ settings: SiteSettings }>
}

export function getProjectVhost(serverId: string, name: string) {
  return request.get(`/servers/${serverId}/projects/${name}/vhost`) as Promise<string>
}

export function getSiteLogs(serverId: string, name: string, type: 'access' | 'error', lines = 200) {
  return request.get(`/servers/${serverId}/projects/${name}/sitelogs`, { params: { type, lines } }) as Promise<string>
}
