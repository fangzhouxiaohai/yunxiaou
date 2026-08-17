<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-card>
      <div class="page-header">
        <span class="page-title">SSL 证书</span>
        <div class="page-actions">
          <el-button type="primary" @click="openUpload">上传证书</el-button>
          <el-button type="warning" @click="openSelf">生成自签证书</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
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

    <el-dialog v-model="uploadDialog" title="上传证书" width="min(640px, 92vw)">
      <el-alert
        type="info"
        show-icon
        :closable="false"
        class="alert-gap"
        title="证书将关联到所选项目的域名（自动添加 443 端口配置）；上传的正式证书不会自动续期，到期前请手动更新。"
      />
      <el-form label-width="90px">
        <el-form-item label="域名" required>
          <el-select v-model="uploadForm.domain" placeholder="选择项目域名" style="width: 100%">
            <el-option v-for="d in domains" :key="d.domain" :label="`${d.domain}（${d.project}）`" :value="d.domain" />
          </el-select>
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

    <el-dialog v-model="selfDialog" title="生成自签证书" width="min(480px, 92vw)">
      <el-alert
        type="success"
        show-icon
        :closable="false"
        class="alert-gap"
        title="生成后自动设置续期：每天检查，剩余不足 30 天时自动重新生成并 reload Nginx。"
      />
      <el-form label-width="90px">
        <el-form-item label="域名" required>
          <el-select v-model="selfDomain" placeholder="选择项目域名" style="width: 100%">
            <el-option v-for="d in domains" :key="d.domain" :label="`${d.domain}（${d.project}）`" :value="d.domain" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="selfDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSelfSigned">生成并设置续期</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="noDomainDialog" title="提示" width="min(420px, 92vw)">
      <el-empty description="暂无可用的项目域名" />
      <p class="no-domain-hint">请先在「项目」中创建项目并配置域名，然后在 SSL 页面选择该域名生成证书。</p>
      <template #footer>
        <el-button type="primary" @click="goProjects">去创建项目</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listCerts, listSslDomains, selfSigned, uploadCert, type CertInfo, type SslDomain } from '@/api/ssl'
import { useServerStore } from '@/stores/server'

const router = useRouter()
const serverStore = useServerStore()
const certs = ref<CertInfo[]>([])
const domains = ref<SslDomain[]>([])
const loading = ref(false)
const saving = ref(false)
const uploadDialog = ref(false)
const selfDialog = ref(false)
const noDomainDialog = ref(false)
const selfDomain = ref('')
const uploadForm = reactive({ domain: '', cert: '', key: '' })

async function load() {
  if (!serverStore.currentId) return
  loading.value = true
  try {
    const [certList, domainList] = await Promise.all([
      listCerts(serverStore.currentId),
      listSslDomains(serverStore.currentId),
    ])
    certs.value = certList
    domains.value = domainList
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openUpload() {
  if (domains.value.length === 0) {
    noDomainDialog.value = true
    return
  }
  uploadDialog.value = true
}

function openSelf() {
  if (domains.value.length === 0) {
    noDomainDialog.value = true
    return
  }
  selfDomain.value = domains.value[0].domain
  selfDialog.value = true
}

function goProjects() {
  noDomainDialog.value = false
  router.push('/projects')
}

async function onUpload() {
  if (!uploadForm.domain || !uploadForm.cert || !uploadForm.key) {
    ElMessage.warning('请填写完整信息')
    return
  }
  await ElMessageBox.confirm(
    `将证书写入服务器 /etc/nginx/ssl/linuxmgr-${uploadForm.domain}.crt/.key，并关联项目 vhost（自动加 443 配置）。`,
    '上传确认',
    { type: 'warning', confirmButtonText: '上传' }
  )
  saving.value = true
  try {
    const result = await uploadCert(serverStore.currentId!, { ...uploadForm })
    const vhostMsg = result.vhost?.linked ? '，已关联项目' : `（${result.vhost?.reason || '未关联'}）`
    ElMessage.success(`上传成功${vhostMsg}`)
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
    ElMessage.warning('请选择域名')
    return
  }
  saving.value = true
  try {
    const result = await selfSigned(serverStore.currentId!, selfDomain.value)
    const vhostMsg = result.vhost?.linked ? '，已关联项目' : `（${result.vhost?.reason || '未关联'}）`
    ElMessage.success(`已生成并设置自动续期（每天检查，剩余 <30 天自动更新）${vhostMsg}`)
    selfDialog.value = false
    selfDomain.value = ''
    await load()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.alert-gap { margin-bottom: 12px; }
.no-domain-hint { color: #909399; font-size: 13px; text-align: center; }
</style>
