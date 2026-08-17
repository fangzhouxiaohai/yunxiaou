import request from './request'

export interface LoginResult {
  token: string
  username: string
  role: string
}

export function login(username: string, password: string) {
  return request.post('/auth/login', { username, password }) as Promise<LoginResult>
}
