<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="toolbar">
        <el-input v-model="pathInput" class="path-input" placeholder="输入路径回车跳转，如 /www 或 /root" @keyup.enter="jumpTo">
          <template #prepend>/</template>
        </el-input>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item v-for="(seg, i) in crumbs" :key="i" @click="goTo(i)">
            <a href="javascript:;" @click.prevent="goTo(i)">{{ seg }}</a>
          </el-breadcrumb-item>
        </el-breadcrumb>
        <div>
          <el-button size="small" type="primary" @click="mkdirDialog = true">新建目录</el-button>
          <el-button size="small" @click="load">刷新</el-button>
        </div>
      </div>
      <el-alert
        v-if="listError"
        :title="listError"
        type="warning"
        show-icon
        :closable="false"
        class="alert-gap"
      />
      <el-table :data="items" v-loading="loading" size="small">
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <el-link v-if="row.type === 'dir'" type="primary" @click="enterDir(row.name)">
              <el-icon><Folder /></el-icon>&nbsp;{{ row.name }}
            </el-link>
            <span v-else-if="row.type === 'link'"><el-icon><Link /></el-icon>&nbsp;{{ row.name }}</span>
            <span v-else><el-icon><Document /></el-icon>&nbsp;{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column prop="size" label="大小" width="90" />
        <el-table-column prop="mtime" label="修改时间" width="160" />
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button v-if="row.type === 'file'" link type="primary" @click="onView(row)">查看</el-button>
            <el-button v-if="row.type === 'file'" link type="primary" @click="onEdit(row)">编辑</el-button>
            <el-button link type="warning" @click="onRename(row)">重命名</el-button>
            <el-button link type="warning" @click="onChmod(row)">权限</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="viewDialog" title="文件内容" width="70%">
      <pre class="file-content">{{ fileContent }}</pre>
    </el-dialog>

    <el-dialog v-model="editDialog" title="编辑文件" width="70%">
      <el-input v-model="editContent" type="textarea" :rows="16" />
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSaveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="mkdirDialog" title="新建目录" width="400px">
      <el-input v-model="mkdirName" placeholder="目录名" @keyup.enter="onMkdir" />
      <template #footer>
        <el-button @click="mkdirDialog = false">取消</el-button>
        <el-button type="primary" @click="onMkdir">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="renameDialog" title="重命名" width="400px">
      <el-input v-model="renameTo" @keyup.enter="onRenameConfirm" />
      <template #footer>
        <el-button @click="renameDialog = false">取消</el-button>
        <el-button type="primary" @click="onRenameConfirm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="chmodDialog" title="修改权限" width="400px">
      <el-input v-model="chmodMode" placeholder="如 755" @keyup.enter="onChmodConfirm" />
      <template #footer>
        <el-button @click="chmodDialog = false">取消</el-button>
        <el-button type="primary" @click="onChmodConfirm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Document, Link } from '@element-plus/icons-vue'
import {
  chmodFile, deleteFile, listFiles, mkdirFile, readFile, renameFile, writeFile, type FileItem,
} from '@/api/files'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const currentPath = ref('/')
const pathInput = ref('')
const items = ref<FileItem[]>([])
const loading = ref(false)
const listError = ref('')
const saving = ref(false)
const viewDialog = ref(false)
const fileContent = ref('')
const editDialog = ref(false)
const editContent = ref('')
const editPath = ref('')
const mkdirDialog = ref(false)
const mkdirName = ref('')
const renameDialog = ref(false)
const renameTo = ref('')
const renamePath = ref('')
const chmodDialog = ref(false)
const chmodMode = ref('')
const chmodPath = ref('')

const crumbs = computed(() => {
  const segs = currentPath.value.split('/').filter(Boolean)
  return ['/', ...segs]
})

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    const data = await listFiles(serverStore.currentId, currentPath.value)
    items.value = data.items
    listError.value = data.error || ''
    pathInput.value = currentPath.value
  } finally {
    loading.value = false
  }
}

function jumpTo() {
  const p = pathInput.value.trim()
  if (!p.startsWith('/')) return
  currentPath.value = p.replace(/\/+/g, '/')
  load()
}

function goTo(index: number) {
  const segs = currentPath.value.split('/').filter(Boolean)
  currentPath.value = '/' + segs.slice(0, index).join('/')
  load()
}

function enterDir(name: string) {
  currentPath.value = `${currentPath.value}/${name}`.replace(/\/+/g, '/')
  load()
}

async function onView(row: FileItem) {
  const p = `${currentPath.value}/${row.name}`
  fileContent.value = await readFile(serverStore.currentId!, p)
  viewDialog.value = true
}

async function onEdit(row: FileItem) {
  editPath.value = `${currentPath.value}/${row.name}`
  editContent.value = await readFile(serverStore.currentId!, editPath.value)
  editDialog.value = true
}

async function onSaveEdit() {
  saving.value = true
  try {
    await writeFile(serverStore.currentId!, editPath.value, editContent.value)
    ElMessage.success('已保存')
    editDialog.value = false
  } finally {
    saving.value = false
  }
}

async function onMkdir() {
  if (!mkdirName.value) return
  await mkdirFile(serverStore.currentId!, `${currentPath.value}/${mkdirName.value}`)
  ElMessage.success('已创建')
  mkdirDialog.value = false
  mkdirName.value = ''
  await load()
}

function onRename(row: FileItem) {
  renamePath.value = `${currentPath.value}/${row.name}`
  renameTo.value = row.name
  renameDialog.value = true
}

async function onRenameConfirm() {
  await renameFile(serverStore.currentId!, renamePath.value, renameTo.value)
  ElMessage.success('已重命名')
  renameDialog.value = false
  await load()
}

function onChmod(row: FileItem) {
  chmodPath.value = `${currentPath.value}/${row.name}`
  chmodMode.value = ''
  chmodDialog.value = true
}

async function onChmodConfirm() {
  await chmodFile(serverStore.currentId!, chmodPath.value, chmodMode.value)
  ElMessage.success('已修改')
  chmodDialog.value = false
  await load()
}

async function onDelete(row: FileItem) {
  const p = `${currentPath.value}/${row.name}`
  await ElMessageBox.confirm(`将「${p}」移入服务器回收站（/tmp/linuxmgr-trash/）。`, '删除确认', { type: 'warning' })
  await deleteFile(serverStore.currentId!, p, true)
  ElMessage.success('已移入回收站')
  await load()
}

onMounted(load)
</script>

<style scoped lang="scss">
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.path-input { width: 320px; }
.alert-gap { margin-bottom: 12px; }
.file-content { background: #0d1117; color: #c9d1d9; padding: 16px; border-radius: 6px; font-size: 12px; max-height: 60vh; overflow: auto; white-space: pre-wrap; word-break: break-all; }
</style>
