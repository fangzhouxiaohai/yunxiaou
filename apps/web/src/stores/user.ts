import { defineStore } from 'pinia'
import { login as apiLogin } from '@/api/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('linuxmgr_token') || '',
    username: localStorage.getItem('linuxmgr_username') || '',
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username: string, password: string) {
      const data = await apiLogin(username, password)
      this.token = data.token
      this.username = data.username
      localStorage.setItem('linuxmgr_token', data.token)
      localStorage.setItem('linuxmgr_username', data.username)
    },
    logout() {
      this.token = ''
      this.username = ''
      localStorage.removeItem('linuxmgr_token')
      localStorage.removeItem('linuxmgr_username')
    },
  },
})
