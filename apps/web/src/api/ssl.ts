import request from './request'

export interface CertInfo {
  domain: string
  crt: string
  subject?: string
  notBefore?: string
  notAfter?: string
  issuer?: string
}

export function listCerts(serverId: string) {
  return request.get(`/servers/${serverId}/ssl`) as Promise<CertInfo[]>
}

export function uploadCert(serverId: string, payload: { domain: string; cert: string; key: string }) {
  return request.post(`/servers/${serverId}/ssl/upload`, payload)
}

export function selfSigned(serverId: string, domain: string) {
  return request.post(`/servers/${serverId}/ssl/selfsigned`, { domain })
}
