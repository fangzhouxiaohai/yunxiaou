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
          <el-button size="small" type="primary" @click="newFileDialog = true">新建文件</el-button>
          <el-button size="small" type="primary" plain @click="mkdirDialog = true">新建文件夹</el-button>
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
      <!-- 上传区：拖拽 / 多选 / 文件夹 -->
      <div class="dropzone" @dragover.prevent @drop.prevent="onDrop">
        <el-icon class="dz-icon"><UploadFilled /></el-icon>
        <span class="dz-text">拖拽文件或文件夹到此处上传（保持目录结构），或</span>
        <el-button size="small" type="primary" @click="fileInput?.click()">选择文件</el-button>
        <el-button size="small" @click="dirInput?.click()">选择文件夹</el-button>
        <input ref="fileInput" type="file" multiple class="hidden-input" @change="onPickFiles" />
        <input ref="dirInput" type="file" webkitdirectory multiple class="hidden-input" @change="onPickFiles" />
      </div>
      <el-progress
        v-if="uploading"
        :percentage="uploadPercent"
        :stroke-width="10"
        class="upload-progress"
        :status="uploadPercent === 100 ? 'success' : undefined"
      />
      <div v-if="uploading" class="upload-hint">正在上传 {{ uploadFilesCount }} 个文件到 {{ currentPath }}…</div>
      <el-table :data="items" v-loading="loading" size="small">
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <el-link
              v-if="row.type === 'dir'"
              type="primary"
              draggable="true"
              class="drop-target"
              @dragstart="onDragStart(row)"
              @dragover.prevent
              @drop.prevent="onDropInto(row)"
              @click="enterDir(row.name)"
            >
              <el-icon><Folder /></el-icon>&nbsp;{{ row.name }}
            </el-link>
            <span v-else-if="row.type === 'link'" draggable="true" class="drag-item" @dragstart="onDragStart(row)">
              <el-icon><Link /></el-icon>&nbsp;{{ row.name }}
            </span>
            <span v-else draggable="true" class="drag-item" @dragstart="onDragStart(row)">
              <el-icon><Document /></el-icon>&nbsp;{{ row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column prop="size" label="大小" width="90" />
        <el-table-column prop="mtime" label="修改时间" width="160" />
        <el-table-column label="操作" width="320">
          <template #default="{ row }">
            <el-button v-if="row.type === 'file'" link type="primary" @click="onView(row)">查看</el-button>
            <el-button v-if="row.type === 'file'" link type="primary" @click="onEdit(row)">编辑</el-button>
            <el-button link type="primary" @click="onCopy(row)">复制</el-button>
            <el-button link type="warning" @click="onMoveDialog(row)">移动</el-button>
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

    <el-dialog v-model="mkdirDialog" title="新建文件夹" width="400px">
      <el-input v-model="mkdirName" placeholder="文件夹名" @keyup.enter="onMkdir" />
      <template #footer>
        <el-button @click="mkdirDialog = false">取消</el-button>
        <el-button type="primary" @click="onMkdir">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="newFileDialog" title="新建文件" width="400px">
      <el-input v-model="newFileName" placeholder="文件名，如 notes.txt" @keyup.enter="onNewFile" />
      <template #footer>
        <el-button @click="newFileDialog = false">取消</el-button>
        <el-button type="primary" @click="onNewFile">创建</el-button>
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

    <el-dialog v-model="copyDialog" title="复制到目录" width="440px">
      <el-input v-model="copyTarget" placeholder="目标目录，如 /www/app/sub" @keyup.enter="onCopyConfirm" />
      <template #footer>
        <el-button @click="copyDialog = false">取消</el-button>
        <el-button type="primary" @click="onCopyConfirm">复制</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="moveDialog" title="移动到目录" width="440px">
      <el-input v-model="moveTarget" placeholder="目标目录，如 /www/app/sub" @keyup.enter="onMoveConfirm" />
      <template #footer>
        <el-button @click="moveDialog = false">取消</el-button>
        <el-button type="primary" @click="onMoveConfirm">移动</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Document, Link, UploadFilled } from '@element-plus/icons-vue'
import {
  chmodFile, copyFile, deleteFile, listFiles, mkdirFile, moveFile, readFile, renameFile,
  touchFile, uploadFiles, writeFile, type FileItem,
} from '@/api/files'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const currentPath = ref('/')
const pathInput = ref('')
const items = ref<FileItem[]>([])
const loading = ref(false)
const listError = ref('')
const fileInput = ref<HTMLInputElement>()
const dirInput = ref<HTMLInputElement>()
const uploading = ref(false)
const uploadPercent = ref(0)
const uploadFilesCount = ref(0)
const saving = ref(false)
const viewDialog = ref(false)
const fileContent = ref('')
const editDialog = ref(false)
const editContent = ref('')
const editPath = ref('')
const mkdirDialog = ref(false)
const mkdirName = ref('')
const newFileDialog = ref(false)
const newFileName = ref('')
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

async function onNewFile() {
  const name = newFileName.value.trim()
  if (!name) {
    ElMessage.warning('请输入文件名')
    return
  }
  await touchFile(serverStore.currentId!, `${currentPath.value}/${name}`)
  ElMessage.success(`已创建 ${name}`)
  newFileDialog.value = false
  newFileName.value = ''
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

// ===== 上传（多文件 / 文件夹 / 拖拽）=====

async function doUpload(files: File[]) {
  if (files.length === 0 || !serverStore.currentId) return
  uploadFilesCount.value = files.length
  uploading.value = true
  uploadPercent.value = 0
  try {
    const result = await uploadFiles(serverStore.currentId, currentPath.value, files, (p) => {
      uploadPercent.value = p
    })
    ElMessage.success(`已上传 ${result.uploaded} 个文件到 ${result.targetDir}`)
    await load()
  } finally {
    uploading.value = false
  }
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    doUpload(Array.from(files))
  }
}

function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (files && files.length > 0) {
    doUpload(Array.from(files))
  }
  input.value = ''
}

// ===== 拖拽移动（文件/文件夹拖入目录行）=====

let dragSource = ''

function onDragStart(row: FileItem) {
  dragSource = `${currentPath.value}/${row.name}`
}

async function onDropInto(row: FileItem) {
  if (!dragSource) return
  const targetDir = `${currentPath.value}/${row.name}`
  if (dragSource === targetDir || targetDir.startsWith(`${dragSource}/`)) {
    ElMessage.warning('不能移动到自身或其子目录')
    dragSource = ''
    return
  }
  const name = dragSource.split('/').pop()
  await ElMessageBox.confirm(`将「${name}」移动到「${targetDir}」？`, '移动确认', { type: 'warning' })
  await moveFile(serverStore.currentId!, dragSource, targetDir, true)
  ElMessage.success('已移动')
  dragSource = ''
  await load()
}

// ===== 复制 / 移动（按钮 + 目录输入）=====

const copyDialog = ref(false)
const copyTarget = ref('')
const copyPath = ref('')
const moveDialog = ref(false)
const moveTarget = ref('')
const movePath = ref('')

function onCopy(row: FileItem) {
  copyPath.value = `${currentPath.value}/${row.name}`
  copyTarget.value = ''
  copyDialog.value = true
}

async function onCopyConfirm() {
  if (!copyTarget.value.trim()) {
    ElMessage.warning('请输入目标目录')
    return
  }
  await copyFile(serverStore.currentId!, copyPath.value, copyTarget.value.trim())
  ElMessage.success('复制完成')
  copyDialog.value = false
  await load()
}

function onMoveDialog(row: FileItem) {
  movePath.value = `${currentPath.value}/${row.name}`
  moveTarget.value = ''
  moveDialog.value = true
}

async function onMoveConfirm() {
  if (!moveTarget.value.trim()) {
    ElMessage.warning('请输入目标目录')
    return
  }
  await moveFile(serverStore.currentId!, movePath.value, moveTarget.value.trim(), true)
  ElMessage.success('已移动')
  moveDialog.value = false
  await load()
}

onMounted(load)
</script>

<style scoped lang="scss">
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.path-input { width: 320px; }
.alert-gap { margin-bottom: 12px; }
.dropzone {
  display: flex; align-items: center; gap: 12px; justify-content: center;
  border: 2px dashed #c0c4cc; border-radius: 8px; padding: 20px; margin-bottom: 12px;
  background: #fafafa; flex-wrap: wrap;
  .dz-icon { font-size: 28px; color: #409eff; }
  .dz-text { color: #606266; font-size: 13px; }
}
.dropzone:hover { border-color: #409eff; background: #ecf5ff; }
.hidden-input { display: none; }
.upload-progress { margin-bottom: 4px; }
.upload-hint { font-size: 12px; color: #909399; margin-bottom: 12px; }
.drag-item { cursor: grab; }
.drop-target { cursor: grab; }
.file-content { background: #0d1117; color: #c9d1d9; padding: 16px; border-radius: 6px; font-size: 12px; max-height: 60vh; overflow: auto; white-space: pre-wrap; word-break: break-all; }
</style>
