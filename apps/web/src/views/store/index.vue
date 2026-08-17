<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-skeleton v-if="loading" animated class="skeleton">
      <template #template>
        <el-row :gutter="16">
          <el-col v-for="i in 8" :key="i" :span="6" class="col">
            <el-card>
              <el-skeleton-item variant="h3" style="width: 60%" />
              <el-skeleton-item variant="text" style="margin-top: 12px" />
              <el-skeleton-item variant="text" style="width: 40%; margin-top: 6px" />
              <el-skeleton-item variant="button" style="width: 100%; margin-top: 16px" />
            </el-card>
          </el-col>
        </el-row>
      </template>
    </el-skeleton>
    <el-row v-else :gutter="16">
      <el-col v-for="item in items" :key="item.name" :span="6" class="col">
        <el-card class="soft-card">
          <div class="soft-name">{{ item.display }}</div>
          <div class="soft-desc">{{ item.desc }}</div>
          <div class="soft-version">
            <el-tag v-if="item.installed" type="success" size="small">{{ item.version || '已安装' }}</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <el-button
            v-if="!item.installed"
            type="primary"
            size="small"
            class="soft-btn"
            :loading="installing === item.name"
            @click="onInstall(item)"
          >
            一键安装
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { installSoftware, listStore, type StoreItem } from '@/api/store'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const items = ref<StoreItem[]>([])
const installing = ref('')
const loading = ref(true)

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    items.value = await listStore(serverStore.currentId)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function onInstall(item: StoreItem) {
  await ElMessageBox.confirm(
    `将通过系统包管理器安装「${item.display}」（包名 ${item.package}），安装过程可能需要数分钟。`,
    '安装软件',
    { type: 'warning', confirmButtonText: '开始安装' }
  )
  installing.value = item.name
  try {
    await installSoftware(serverStore.currentId!, item.name)
    ElMessage.success('安装完成')
    await load()
  } finally {
    installing.value = ''
  }
}
</script>

<style scoped lang="scss">
.col { margin-bottom: 16px; }
.soft-card {
  .soft-name { font-size: 18px; font-weight: 600; }
  .soft-desc { color: #909399; font-size: 13px; margin: 8px 0; min-height: 36px; }
  .soft-version { margin-bottom: 12px; }
  .soft-btn { width: 100%; }
}
</style>
