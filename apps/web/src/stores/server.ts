import { defineStore } from 'pinia'
import { listServers, type ServerInfo } from '@/api/servers'

export const useServerStore = defineStore('server', {
  state: () => ({
    servers: [] as ServerInfo[],
    currentId: localStorage.getItem('linuxmgr_current_server') || '',
  }),
  getters: {
    current(state): ServerInfo | undefined {
      return state.servers.find((s) => s.id === state.currentId)
    },
  },
  actions: {
    async load() {
      this.servers = await listServers()
      if (!this.servers.some((s) => s.id === this.currentId)) {
        this.currentId = this.servers[0]?.id || ''
        localStorage.setItem('linuxmgr_current_server', this.currentId)
      }
    },
    switchServer(id: string) {
      this.currentId = id
      localStorage.setItem('linuxmgr_current_server', id)
    },
  },
})
