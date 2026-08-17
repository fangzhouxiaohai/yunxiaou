<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="uploadDialog = true">上传证书</el-button>
        <el-button type="warning" @click="selfDialog = true">生成自签证书</el-button>
        <el-button @click="load">刷新</el-button>
      </div>
      <el-table :data="certs" v-loading="loading">
        <el-table-column prop="domain" label="域名" min-width="160" />
        <el-table-column prop="subject" label="主题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="notBefore" label="生效时间" min-width="150" />
        <el-table-column prop="notAfter" label="到期时间" min-width="150" />
        <el-table-column prop="issuer" label="颁发者" min-width="180" show-overflow-tooltip />
      </el-table>
      <el-empty v-if="!loading && certs.length === 0" description="暂无证书" />
    </el-card>

    <el-dialog v-model="uploadDialog" title="上传证书" width="640px">
      <el-form label-width="90px">
        <el-form-item label="域名" required>
          <el-input v-model="uploadForm.domain" placeholder="如 example.com" />
        </el-form-item>
        <el-form-item label="证书 (crt)" required>
          <el-input v-model="uploadForm.cert" type="textarea" :rows="6" placeholder="-----BEGIN CERTIFICATE-----" />
        </el-form-item>
        <el-form-item label="私钥 (key)" required>
          <el-input v-model="uploadForm.key" type="textarea" :rows="6" placeholder="-----BEGIN PRIVATE KEY-----" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onUpload">上传</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="selfDialog" title="生成自签证书" width="440px">
      <el-form label-width="90px">
        <el-form-item label="域名" required>
          <el-input v-model="selfDomain" placeholder="如 test.local" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="selfDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSelfSigned">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listCerts, selfSigned, uploadCert, type CertInfo } from '@/api/ssl'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const certs = ref<CertInfo[]>([])
const loading = ref(false)
const saving = ref(false)
const uploadDialog = ref(false)
const selfDialog = ref(false)
const selfDomain = ref('')
const uploadForm = reactive({ domain: '', cert: '', key: '' })

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    certs.value = await listCerts(serverStore.currentId)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function onUpload() {
  if (!uploadForm.domain || !uploadForm.cert || !uploadForm.key) {
    ElMessage.warning('请填写完整信息')
    return
  }
  await ElMessageBox.confirm(
    `将证书写入服务器 /etc/nginx/ssl/linuxmgr-${uploadForm.domain}.crt/.key。`,
    '上传确认',
    { type: 'warning', confirmButtonText: '上传' }
  )
  saving.value = true
  try {
    await uploadCert(serverStore.currentId!, { ...uploadForm })
    ElMessage.success('上传成功')
    uploadDialog.value = false
    uploadForm.domain = ''
    uploadForm.cert = ''
    uploadForm.key = ''
    await load()
  } finally {
    saving.value = false
  }
}

async function onSelfSigned() {
  if (!selfDomain.value) {
    ElMessage.warning('请输入域名')
    return
  }
  saving.value = true
  try {
    await selfSigned(serverStore.currentId!, selfDomain.value)
    ElMessage.success('已生成（365 天有效期）')
    selfDialog.value = false
    selfDomain.value = ''
    await load()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.toolbar { margin-bottom: 16px; }
</style>
