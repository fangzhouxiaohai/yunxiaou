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
          <div class="soft-head">
            <div class="soft-name">{{ item.display }}</div>
            <el-tag v-if="item.installed" type="success" size="small">已安装</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <div class="soft-desc">{{ item.desc }}</div>
          <div class="soft-version">
            <el-tag v-if="item.installed && item.version" type="info" size="small">{{ item.version }}</el-tag>
            <span v-if="item.name === 'java' && item.installed" class="java-default">默认：{{ item.defaultVersion }}</span>
          </div>

          <!-- PHP 版本 -->
          <template v-if="item.type === 'php'">
            <el-button
              v-if="!item.installed"
              type="primary"
              size="small"
              class="soft-btn"
              :loading="installing === item.name"
              @click="onInstall(item)"
            >一键安装</el-button>
          </template>

          <!-- Java -->
          <template v-else-if="item.type === 'java'">
            <div v-if="item.installed" class="java-switch">
              <el-select v-model="javaVersion" size="small" placeholder="切换版本" style="width: 130px">
                <el-option v-for="v in item.versions" :key="v" :label="`Java ${v}`" :value="v" />
              </el-select>
              <el-button size="small" type="warning" :loading="switchingJava" @click="onSwitchJava">切换</el-button>
            </div>
            <el-button
              v-else
              type="primary"
              size="small"
              class="soft-btn"
              :loading="installing === item.name"
              @click="onInstall(item, '8')"
            >安装 Java 8</el-button>
          </template>

          <!-- Composer -->
          <template v-else-if="item.type === 'composer'">
            <el-tooltip v-if="!phpInstalled" content="请先安装 PHP" placement="top">
              <el-button type="primary" size="small" class="soft-btn" disabled>一键安装</el-button>
            </el-tooltip>
            <el-button
              v-else-if="!item.installed"
              type="primary"
              size="small"
              class="soft-btn"
              :loading="installing === item.name"
              @click="onInstall(item)"
            >一键安装</el-button>
          </template>

          <!-- supervisor / disk 工具卡片 -->
          <template v-else-if="item.type === 'supervisor' || item.type === 'disk'">
            <el-button type="primary" size="small" class="soft-btn" @click="openTool(item)">
              管理
            </el-button>
          </template>

          <!-- 普通软件 -->
          <template v-else>
            <el-button
              v-if="!item.installed"
              type="primary"
              size="small"
              class="soft-btn"
              :loading="installing === item.name"
              @click="onInstall(item)"
            >一键安装</el-button>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { installSoftware, listStore, switchJava, type StoreItem } from '@/api/store'
import { useServerStore } from '@/stores/server'

const router = useRouter()
const serverStore = useServerStore()
const items = ref<StoreItem[]>([])
const installing = ref('')
const switchingJava = ref(false)
const javaVersion = ref('')
const loading = ref(true)

const phpInstalled = computed(() => items.value.some((i) => i.type === 'php' && i.installed))

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

async function onInstall(item: StoreItem, version?: string) {
  const desc = version ? `Java ${version}` : item.display
  await ElMessageBox.confirm(
    `将通过系统包管理器安装「${desc}」，安装过程可能需要数分钟。`,
    '安装软件',
    { type: 'warning', confirmButtonText: '开始安装' }
  )
  installing.value = item.name
  try {
    await installSoftware(serverStore.currentId!, item.name, version)
    ElMessage.success('安装完成')
    await load()
  } finally {
    installing.value = ''
  }
}

async function onSwitchJava() {
  if (!javaVersion.value) {
    ElMessage.warning('请选择要切换的版本')
    return
  }
  await ElMessageBox.confirm(
    `将把系统默认 Java 切换到 ${javaVersion.value} 版本（通过 alternatives）。`,
    '切换 Java 版本',
    { type: 'warning', confirmButtonText: '切换' }
  )
  switchingJava.value = true
  try {
    await switchJava(serverStore.currentId!, javaVersion.value)
    ElMessage.success('切换成功')
    await load()
  } finally {
    switchingJava.value = false
  }
}

function openTool(item: StoreItem) {
  if (item.type === 'disk') {
    router.push('/disk')
  } else if (item.type === 'supervisor') {
    router.push('/supervisor')
  }
}
</script>

<style scoped lang="scss">
.col { margin-bottom: 16px; }
.soft-card {
  .soft-head { display: flex; justify-content: space-between; align-items: center; }
  .soft-name { font-size: 18px; font-weight: 600; }
  .soft-desc { color: #909399; font-size: 13px; margin: 8px 0; min-height: 36px; }
  .soft-version { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .java-default { font-size: 12px; color: #67c23a; }
  .java-switch { display: flex; gap: 8px; }
  .soft-btn { width: 100%; }
}
</style>
