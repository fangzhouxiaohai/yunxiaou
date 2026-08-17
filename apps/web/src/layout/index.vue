<template>
  <el-container class="layout">
    <el-aside v-if="!isMobile" :width="collapsed ? '64px' : '220px'" class="aside">
      <div class="logo-row" :class="{ collapsed }">
        <div class="brand">
          <BrandLogo :size="26" />
          <span v-if="!collapsed" class="brand-name">云小U</span>
        </div>
        <el-icon
          class="collapse-btn"
          :title="collapsed ? '展开菜单' : '折叠菜单'"
          @click="toggleCollapse"
        >
          <Expand v-if="collapsed" />
          <Fold v-else />
        </el-icon>
      </div>
      <SideMenu :collapsed="collapsed" />
    </el-aside>
    <el-drawer
      v-model="drawerVisible"
      direction="ltr"
      :with-header="false"
      size="220px"
      class="menu-drawer"
    >
      <div class="logo-row drawer-brand">
        <div class="brand">
          <BrandLogo :size="26" />
          <span class="brand-name">云小U</span>
        </div>
      </div>
      <SideMenu @select="drawerVisible = false" />
    </el-drawer>
    <el-container>
      <el-header class="header" height="56px">
        <div class="header-left">
          <el-icon v-if="isMobile" class="menu-btn" @click="drawerVisible = true"><Expand /></el-icon>
          <div class="header-title">{{ $route.meta.title || '' }}</div>
        </div>
        <div class="header-right">
          <el-tooltip :content="themeStore.mode === 'dark' ? '切换为亮色' : '切换为暗色'" placement="bottom">
            <el-icon class="theme-btn" @click="themeStore.toggle()">
              <Sunny v-if="themeStore.mode === 'dark'" />
              <Moon v-else />
            </el-icon>
          </el-tooltip>
          <el-select
            :model-value="serverStore.currentId"
            placeholder="选择服务器"
            class="server-select"
            @change="serverStore.switchServer"
          >
            <el-option
              v-for="s in serverStore.servers"
              :key="s.id"
              :label="`${s.name} (${s.host})`"
              :value="s.id"
            />
          </el-select>
          <span class="divider" />
          <el-dropdown @command="onCommand">
            <span class="user">
              <el-icon><User /></el-icon>
              <span class="username">{{ userStore.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="pwdVisible" title="修改密码" width="min(400px, 92vw)">
    <el-form :model="pwdForm" label-width="80px">
      <el-form-item label="原密码">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input v-model="pwdForm.confirm" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdVisible = false">取消</el-button>
      <el-button type="primary" :loading="pwdLoading" @click="onChangePassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Expand, Fold, Sunny, Moon, User, ArrowDown } from '@element-plus/icons-vue'
import SideMenu from './SideMenu.vue'
import BrandLogo from './BrandLogo.vue'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { changePassword } from '@/api/auth'

const router = useRouter()
const serverStore = useServerStore()
const userStore = useUserStore()
const themeStore = useThemeStore()

// 桌面端菜单折叠状态，localStorage 持久化
const collapsed = ref(localStorage.getItem('menu-collapsed') === '1')
watch(collapsed, (v) => localStorage.setItem('menu-collapsed', v ? '1' : '0'))
function toggleCollapse() {
  collapsed.value = !collapsed.value
}

const drawerVisible = ref(false)
const isMobile = ref(window.matchMedia('(max-width: 1023px)').matches)
const mq = window.matchMedia('(max-width: 1023px)')
function onMqChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
  if (!e.matches) drawerVisible.value = false
}

const pwdVisible = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

onMounted(() => {
  serverStore.load().catch(() => {})
  mq.addEventListener('change', onMqChange)
})
onBeforeUnmount(() => mq.removeEventListener('change', onMqChange))

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  } else if (cmd === 'password') {
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirm = ''
    pwdVisible.value = true
  }
}

async function onChangePassword() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    ElMessage.warning('请填写原密码和新密码')
    return
  }
  if (pwdForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirm) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  pwdLoading.value = true
  try {
    await changePassword(pwdForm.oldPassword, pwdForm.newPassword)
    ElMessage.success('密码修改成功')
    pwdVisible.value = false
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    pwdLoading.value = false
  }
}
</script>

<style scoped lang="scss">
.layout { height: 100%; }
.aside {
  background: linear-gradient(180deg, var(--aside-bg), var(--aside-bg-2));
  transition: width 0.2s ease;
  overflow: hidden;
}
.logo-row {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .brand-name {
    color: #fff;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 1px;
    white-space: nowrap;
  }
  .collapse-btn {
    font-size: 18px;
    color: rgba(255, 255, 255, 0.65);
    cursor: pointer;
    flex-shrink: 0;
    &:hover { color: #fff; }
  }
  &.collapsed {
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    height: auto;
    padding: 10px 0;
  }
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  box-shadow: 0 1px 4px rgba(16, 32, 64, 0.08);
  position: relative;
  z-index: 1;
  .header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .menu-btn { font-size: 20px; cursor: pointer; color: var(--text-2); }
  .header-title { font-size: 17px; font-weight: 600; white-space: nowrap; }
  .header-right { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .theme-btn { font-size: 18px; cursor: pointer; color: var(--text-2); &:hover { color: var(--brand); } }
  .server-select { width: 240px; max-width: 40vw; }
  .divider { width: 1px; height: 20px; background: var(--border); }
  .user {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    &:hover { color: var(--brand); }
  }
}
.main { background: var(--bg-page); padding: var(--gap); }

@media (max-width: 767px) {
  .header .username { display: none; }
  .header .server-select { width: 150px; }
}
</style>

<style lang="scss">
// 移动端抽屉内的深色菜单（需全局选择器穿透 drawer）
.menu-drawer {
  --el-drawer-bg-color: var(--aside-bg);
  background: linear-gradient(180deg, var(--aside-bg), var(--aside-bg-2));
  .drawer-brand { justify-content: center; }
  .logo-row {
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 4px;
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-name {
      color: #fff;
      font-size: 19px;
      font-weight: 600;
      letter-spacing: 1px;
    }
  }
}
</style>
