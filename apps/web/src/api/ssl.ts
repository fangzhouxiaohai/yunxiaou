import request from './request'

export interface CertInfo {
  domain: string
  crt: string
  subject?: string
  notBefore?: string
  notAfter?: string
  issuer?: string
}

export interface SslDomain {
  domain: string
  project: string
  type: string
}

export function listSslDomains(serverId: string) {
  return request.get(`/servers/${serverId}/ssl/domains`) as Promise<SslDomain[]>
}

export function listCerts(serverId: string) {
  return request.get(`/servers/${serverId}/ssl`) as Promise<CertInfo[]>
}

export function uploadCert(serverId: string, payload: { domain: string; cert: string; key: string }) {
  return request.post(`/servers/${serverId}/ssl/upload`, payload) as Promise<{ domain: string; vhost?: { linked: boolean; reason: string } }>
}

export function selfSigned(serverId: string, domain: string) {
  return request.post(`/servers/${serverId}/ssl/selfsigned`, { domain }) as Promise<{ domain: string; autoRenew: boolean; vhost?: { linked: boolean; reason: string } }>
}
