import { defineStore } from 'pinia'

type ThemeMode = 'light' | 'dark'
const KEY = 'linuxmgr_theme'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: (localStorage.getItem(KEY) as ThemeMode | null) || (systemPrefersDark() ? 'dark' : 'light') as ThemeMode,
  }),
  actions: {
    apply() {
      document.documentElement.classList.toggle('dark', this.mode === 'dark')
    },
    toggle() {
      this.mode = this.mode === 'dark' ? 'light' : 'dark'
      localStorage.setItem(KEY, this.mode)
      this.apply()
    },
  },
})
