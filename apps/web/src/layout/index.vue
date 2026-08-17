<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">云小U</div>
      <el-menu
        router
        :default-active="$route.path"
        background-color="#001529"
        text-color="#a6adb4"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon><span>监控大盘</span>
        </el-menu-item>
        <el-menu-item index="/servers">
          <el-icon><Monitor /></el-icon><span>服务器管理</span>
        </el-menu-item>
        <el-menu-item index="/databases">
          <el-icon><Coin /></el-icon><span>数据库管理</span>
        </el-menu-item>
        <el-menu-item index="/store">
          <el-icon><Shop /></el-icon><span>软件商店</span>
        </el-menu-item>
        <el-menu-item index="/disk">
          <el-icon><Files /></el-icon><span>磁盘管理</span>
        </el-menu-item>
        <el-menu-item index="/supervisor">
          <el-icon><Cpu /></el-icon><span>进程守护</span>
        </el-menu-item>
        <el-menu-item index="/projects">
          <el-icon><Box /></el-icon><span>项目</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-title">{{ $route.meta.title || '' }}</div>
        <div class="header-right">
          <el-select
            :model-value="serverStore.currentId"
            placeholder="选择服务器"
            style="width: 240px"
            @change="serverStore.switchServer"
          >
            <el-option
              v-for="s in serverStore.servers"
              :key="s.id"
              :label="`${s.name} (${s.host})`"
              :value="s.id"
            />
          </el-select>
          <el-dropdown @command="onCommand">
            <span class="user">{{ userStore.username }} <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
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
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Odometer, Monitor, Coin, Shop, Files, Cpu, Box, ArrowDown } from '@element-plus/icons-vue'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const serverStore = useServerStore()
const userStore = useUserStore()

onMounted(() => {
  serverStore.load().catch(() => {})
})

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  }
}
</script>

<style scoped lang="scss">
.layout { height: 100%; }
.aside {
  background: #001529;
  .logo { height: 56px; line-height: 56px; text-align: center; color: #fff; font-size: 20px; font-weight: 600; }
  :deep(.el-menu) { border-right: none; }
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border-bottom: 1px solid #e8e8e8;
  .header-title { font-size: 16px; font-weight: 600; }
  .header-right { display: flex; align-items: center; gap: 16px; .user { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; } }
}
.main { background: #f0f2f5; }
</style>
