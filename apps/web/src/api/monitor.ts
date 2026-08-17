import request from './request'

export interface MonitorData {
  cpu: { us: number; sy: number; id: number }
  load: number[]
  mem: { totalMB: number; usedMB: number; availMB: number; percent: number }
  disk: Array<{ fs: string; size: string; used: string; percent: number; mount: string }>
  net: { rxBytes: number; txBytes: number; rxRate: number; txRate: number }
  uptimeSec: number
  os: string
}

export function getMonitor(serverId: string) {
  return request.get(`/servers/${serverId}/monitor`) as Promise<MonitorData>
}
