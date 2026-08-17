import request from './request'

export interface ServerInfo {
  id: string
  name: string
  host: string
  port: number
  username: string
  hasPassword: boolean
  createdAt: string
}

export interface ServerPayload {
  name: string
  host: string
  port: number
  username: string
  password?: string
}

export function listServers() {
  return request.get('/servers') as Promise<ServerInfo[]>
}

export function createServer(payload: ServerPayload) {
  return request.post('/servers', payload) as Promise<ServerInfo>
}

export function updateServer(id: string, payload: ServerPayload) {
  return request.put(`/servers/${id}`, payload) as Promise<ServerInfo>
}

export function deleteServer(id: string) {
  return request.delete(`/servers/${id}`)
}

export function testServer(id: string) {
  return request.post(`/servers/${id}/test`) as Promise<{ ok: boolean; uname: string }>
}
