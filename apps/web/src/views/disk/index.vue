<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <div class="page-header">
      <span class="page-title">磁盘管理</span>
      <div class="page-actions"></div>
    </div>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="磁盘与分区" name="disks">
        <el-card>
          <el-table :data="disks" v-loading="loading" row-key="name" :tree-props="{ children: 'partitions' }">
            <el-table-column prop="name" label="设备" width="120" />
            <el-table-column prop="size" label="大小" width="100" />
            <el-table-column prop="type" label="类型" width="80" />
            <el-table-column prop="mount" label="挂载点" min-width="120" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button
                  v-if="row.type === 'part' && !row.mount"
                  link
                  type="primary"
                  @click="openMountDialog(row)"
                >挂载</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="挂载点" name="mounts">
        <el-card>
          <el-table :data="mounts" v-loading="loading">
            <el-table-column prop="fs" label="文件系统" min-width="120" />
            <el-table-column prop="size" label="大小" width="90" />
            <el-table-column prop="used" label="已用" width="90" />
            <el-table-column prop="avail" label="可用" width="90" />
            <el-table-column label="使用率" width="160">
              <template #default="{ row }">
                <el-progress :percentage="row.percent" :stroke-width="12" />
              </template>
            </el-table-column>
            <el-table-column prop="mount" label="挂载点" min-width="120" />
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button v-if="!protectedMounts.includes(row.mount)" link type="danger" @click="onUmount(row)">
                  卸载
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="mountDialogVisible" title="挂载分区" width="min(440px, 92vw)">
      <el-form label-width="90px">
        <el-form-item label="设备">
          <el-input :model-value="`/dev/${mountForm.device}`" disabled />
        </el-form-item>
        <el-form-item label="挂载点" required>
          <el-input v-model="mountForm.mountPoint" placeholder="如 /data（不能是系统关键路径）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mountDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="mounting" @click="onMount">挂载</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getDisk, mountDevice, umountDevice, type DiskInfo, type MountInfo } from '@/api/disk'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('disks')
const disks = ref<DiskInfo[]>([])
const mounts = ref<MountInfo[]>([])
const loading = ref(false)
const mounting = ref(false)
const mountDialogVisible = ref(false)
const mountForm = reactive({ device: '', mountPoint: '' })

// 与后端 PROTECTED_MOUNTS 一致
const protectedMounts = ['/', '/etc', '/var', '/usr', '/boot', '/home', '/root', '/tmp', '/dev', '/proc', '/sys', '/run', '/opt', '/srv']

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    const data = await getDisk(serverStore.currentId)
    disks.value = data.disks
    mounts.value = data.mounts
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openMountDialog(row: DiskInfo['partitions'][number]) {
  mountForm.device = row.name
  mountForm.mountPoint = ''
  mountDialogVisible.value = true
}

async function onMount() {
  if (!mountForm.mountPoint.trim()) {
    ElMessage.warning('请输入挂载点')
    return
  }
  await ElMessageBox.confirm(
    `将把 /dev/${mountForm.device} 挂载到 ${mountForm.mountPoint}（自动创建目录）。`,
    '挂载确认',
    { type: 'warning', confirmButtonText: '挂载' }
  )
  mounting.value = true
  try {
    await mountDevice(serverStore.currentId!, {
      device: `/dev/${mountForm.device}`,
      mountPoint: mountForm.mountPoint.trim(),
    })
    ElMessage.success('挂载成功')
    mountDialogVisible.value = false
    await load()
  } finally {
    mounting.value = false
  }
}

async function onUmount(row: MountInfo) {
  await ElMessageBox.confirm(`确定卸载 ${row.mount}（${row.fs}）吗？`, '卸载确认', { type: 'warning' })
  await umountDevice(serverStore.currentId!, row.mount, true)
  ElMessage.success('已卸载')
  await load()
}
</script>
