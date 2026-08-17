<template>
  <el-menu
    router
    :default-active="$route.path"
    class="side-menu"
    background-color="transparent"
    :text-color="'var(--aside-text)'"
    active-text-color="#ffffff"
    :collapse="collapsed"
    :collapse-transition="false"
    @select="emit('select')"
  >
    <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><template #title><span>数据监控</span></template></el-menu-item>
    <el-menu-item index="/servers"><el-icon><Monitor /></el-icon><template #title><span>服务器管理</span></template></el-menu-item>
    <el-menu-item index="/databases"><el-icon><Coin /></el-icon><template #title><span>数据库管理</span></template></el-menu-item>
    <el-menu-item index="/store"><el-icon><Shop /></el-icon><template #title><span>软件商店</span></template></el-menu-item>
    <el-menu-item index="/disk"><el-icon><Files /></el-icon><template #title><span>磁盘管理</span></template></el-menu-item>
    <el-menu-item index="/supervisor"><el-icon><Cpu /></el-icon><template #title><span>进程守护</span></template></el-menu-item>
    <el-menu-item index="/projects"><el-icon><Box /></el-icon><template #title><span>网站管理</span></template></el-menu-item>
    <el-menu-item index="/terminal"><el-icon><Monitor /></el-icon><template #title><span>命令终端</span></template></el-menu-item>
    <el-menu-item index="/logs"><el-icon><Document /></el-icon><template #title><span>日志管理</span></template></el-menu-item>
    <el-menu-item index="/crontab"><el-icon><AlarmClock /></el-icon><template #title><span>计划任务</span></template></el-menu-item>
    <el-menu-item index="/files"><el-icon><Folder /></el-icon><template #title><span>文件管理</span></template></el-menu-item>
    <el-menu-item index="/ssl"><el-icon><Lock /></el-icon><template #title><span>SSL 证书</span></template></el-menu-item>
  </el-menu>
</template>

<script setup lang="ts">
import { Odometer, Monitor, Coin, Shop, Files, Cpu, Box, Document, AlarmClock, Folder, Lock } from '@element-plus/icons-vue'

withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })
const emit = defineEmits<{ (e: 'select'): void }>()
</script>

<style lang="scss">
.side-menu {
  border-right: none;
  padding: 8px;
  --el-menu-item-height: 44px;
  --el-menu-item-font-size: 14px;
  &.el-menu--collapse { padding: 8px 6px; }
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
  // 折叠态：图标居中，隐藏左侧激活条避免错位
  &.el-menu--collapse .el-menu-item {
    padding: 0 !important;
    justify-content: center;
    &.is-active::before { display: none; }
  }
}
</style>
