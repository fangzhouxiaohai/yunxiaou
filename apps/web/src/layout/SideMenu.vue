<template>
  <el-menu
    router
    :default-active="$route.path"
    class="side-menu"
    background-color="transparent"
    :text-color="'var(--aside-text)'"
    active-text-color="#ffffff"
    @select="emit('select')"
  >
    <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><span>监控大盘</span></el-menu-item>
    <el-menu-item index="/servers"><el-icon><Monitor /></el-icon><span>服务器管理</span></el-menu-item>
    <el-menu-item index="/databases"><el-icon><Coin /></el-icon><span>数据库管理</span></el-menu-item>
    <el-menu-item index="/store"><el-icon><Shop /></el-icon><span>软件商店</span></el-menu-item>
    <el-menu-item index="/disk"><el-icon><Files /></el-icon><span>磁盘管理</span></el-menu-item>
    <el-menu-item index="/supervisor"><el-icon><Cpu /></el-icon><span>进程守护</span></el-menu-item>
    <el-menu-item index="/projects"><el-icon><Box /></el-icon><span>项目</span></el-menu-item>
    <el-menu-item index="/terminal"><el-icon><Monitor /></el-icon><span>终端</span></el-menu-item>
    <el-menu-item index="/logs"><el-icon><Document /></el-icon><span>日志</span></el-menu-item>
    <el-menu-item index="/crontab"><el-icon><AlarmClock /></el-icon><span>计划任务</span></el-menu-item>
    <el-menu-item index="/files"><el-icon><Folder /></el-icon><span>文件管理</span></el-menu-item>
    <el-menu-item index="/ssl"><el-icon><Lock /></el-icon><span>SSL 证书</span></el-menu-item>
  </el-menu>
</template>

<script setup lang="ts">
import { Odometer, Monitor, Coin, Shop, Files, Cpu, Box, Document, AlarmClock, Folder, Lock } from '@element-plus/icons-vue'

const emit = defineEmits<{ (e: 'select'): void }>()
</script>

<style lang="scss">
.side-menu {
  border-right: none;
  padding: 8px;
  --el-menu-item-height: 44px;
  --el-menu-item-font-size: 14px;
  .el-menu-item {
    border-radius: 6px;
    margin-bottom: 2px;
    position: relative;
    transition: background 0.2s;
    &:hover { background: rgba(255, 255, 255, 0.06); }
    &.is-active {
      background: var(--aside-active-bg);
      color: var(--aside-active-text);
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 3px;
        border-radius: 2px;
        background: var(--aside-bar);
      }
    }
  }
}
</style>
