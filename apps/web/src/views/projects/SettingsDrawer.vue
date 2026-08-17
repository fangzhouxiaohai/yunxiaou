<template>
  <el-drawer
    :model-value="modelValue"
    :title="project ? `网站设置 - ${project.name}` : '网站设置'"
    size="min(860px, 100vw)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="settings-body">
      <el-menu :default-active="activeMenu" class="settings-menu" @select="activeMenu = $event">
        <el-menu-item v-for="m in menus" :key="m.key" :index="m.key">{{ m.title }}</el-menu-item>
      </el-menu>
      <div class="settings-content">
        <template v-if="loaded">
          <!-- 域名管理 -->
          <div v-show="activeMenu === 'domain'" class="section">
            <el-form label-width="80px">
              <el-form-item label="绑定域名">
                <el-select
                  v-model="domainForm.domains"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入域名回车添加"
                  style="width: 100%"
                />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ domains: domainForm.domains })">保存</el-button>
          </div>

          <!-- 网站目录 -->
          <div v-show="activeMenu === 'dir'" class="section">
            <el-form label-width="80px">
              <el-form-item label="运行目录">
                <el-input v-model="dirForm.runDir" placeholder="/public" />
                <div class="tip">部分框架需指定二级运行目录，如 ThinkPHP5、Laravel</div>
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ runDir: dirForm.runDir })">保存</el-button>
          </div>

          <!-- 伪静态 -->
          <div v-show="activeMenu === 'rewrite'" class="section">
            <el-form label-width="80px">
              <el-form-item label="预设">
                <el-select v-model="rewriteForm.preset" style="width: 240px">
                  <el-option v-for="p in rewritePresets" :key="p.value" :label="p.label" :value="p.value" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="rewriteForm.preset === 'custom'" label="自定义规则">
                <el-input v-model="rewriteForm.custom" type="textarea" :rows="6" placeholder="输入 rewrite 规则" />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ rewrite: { ...rewriteForm } })">保存</el-button>
          </div>

          <!-- 默认文档 -->
          <div v-show="activeMenu === 'indexDoc'" class="section">
            <el-form label-width="80px">
              <el-form-item label="默认文档">
                <el-input v-model="indexForm.index" placeholder="index.php index.html" />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ index: indexForm.index })">保存</el-button>
          </div>

          <!-- 访问限制 -->
          <div v-show="activeMenu === 'access'" class="section">
            <el-form label-width="80px">
              <el-form-item label="IP 白名单">
                <el-select
                  v-model="accessForm.allow"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入 IP 或 CIDR 回车"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="IP 黑名单">
                <el-select
                  v-model="accessForm.deny"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入 IP 或 CIDR 回车"
                  style="width: 100%"
                />
              </el-form-item>
            </el-form>
            <el-divider content-position="left">Basic 认证</el-divider>
            <el-form label-width="80px">
              <el-form-item label="启用">
                <el-switch v-model="basicAuthForm.enabled" />
              </el-form-item>
              <template v-if="basicAuthForm.enabled">
                <el-form-item label="用户名">
                  <el-input v-model="basicAuthForm.username" style="width: 240px" />
                </el-form-item>
                <el-form-item label="密码">
                  <el-input
                    v-model="basicAuthForm.password"
                    show-password
                    placeholder="留空则不修改"
                    style="width: 240px"
                  />
                </el-form-item>
              </template>
            </el-form>
            <el-button type="primary" :loading="saving" @click="saveAccess">保存</el-button>
          </div>

          <!-- 防盗链 -->
          <div v-show="activeMenu === 'leech'" class="section">
            <el-form label-width="110px">
              <el-form-item label="启用防盗链">
                <el-switch v-model="leechForm.enabled" />
              </el-form-item>
              <el-form-item label="允许空 Referer">
                <el-switch v-model="leechForm.allowEmpty" />
              </el-form-item>
              <el-form-item label="允许的域名">
                <el-select
                  v-model="leechForm.referers"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入域名回车添加"
                  style="width: 100%"
                />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ antiLeech: { ...leechForm } })">保存</el-button>
          </div>

          <!-- 重定向 -->
          <div v-show="activeMenu === 'redirect'" class="section">
            <div v-for="(r, i) in redirectForm" :key="i" class="redirect-row">
              <el-input v-model="r.from" placeholder="来源路径 如 /old" />
              <el-input v-model="r.to" placeholder="目标地址 如 /new 或 https://..." />
              <el-select v-model="r.type" style="width: 100px">
                <el-option :value="301" label="301" />
                <el-option :value="302" label="302" />
              </el-select>
              <el-button link type="danger" @click="redirectForm.splice(i, 1)">删除</el-button>
            </div>
            <el-button @click="redirectForm.push({ from: '', to: '', type: 301 })">添加规则</el-button>
            <div class="section-actions">
              <el-button type="primary" :loading="saving" @click="save({ redirects: redirectForm.map(r => ({ ...r })) })">保存</el-button>
            </div>
          </div>

          <!-- 反向代理 -->
          <div v-show="activeMenu === 'proxy'" class="section">
            <el-form label-width="80px">
              <el-form-item label="启用">
                <el-switch v-model="proxyForm.enabled" />
              </el-form-item>
              <el-form-item v-if="proxyForm.enabled" label="目标地址">
                <el-input v-model="proxyForm.target" placeholder="留空默认 http://127.0.0.1:项目端口" />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ proxy: { ...proxyForm } })">保存</el-button>
          </div>

          <!-- PHP 版本 -->
          <div v-show="activeMenu === 'php'" class="section">
            <el-form label-width="80px">
              <el-form-item label="PHP 版本">
                <el-select v-model="phpForm.phpVersion" style="width: 240px">
                  <el-option v-for="v in phpVersions" :key="v" :label="v" :value="v" />
                </el-select>
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ phpVersion: phpForm.phpVersion })">保存</el-button>
          </div>

          <!-- SSL -->
          <div v-show="activeMenu === 'ssl'" class="section">
            <el-form label-width="80px">
              <el-form-item label="当前证书">
                <span>{{ sslDomain || '未关联' }}</span>
              </el-form-item>
            </el-form>
            <el-button type="primary" @click="goSsl">去 SSL 证书页管理</el-button>
          </div>

          <!-- 配置文件 -->
          <div v-show="activeMenu === 'config'" class="section">
            <div class="section-toolbar">
              <el-button :loading="vhostLoading" @click="loadVhost">刷新预览</el-button>
            </div>
            <pre class="code-box">{{ vhost || '点击「刷新预览」查看当前 Nginx 配置' }}</pre>
            <el-form label-width="80px" style="margin-top: 16px">
              <el-form-item label="自定义片段">
                <el-input
                  v-model="configForm.customSnippet"
                  type="textarea"
                  :rows="6"
                  placeholder="插入 server 块的自定义 Nginx 指令"
                />
              </el-form-item>
            </el-form>
            <el-button type="primary" :loading="saving" @click="save({ customSnippet: configForm.customSnippet })">保存</el-button>
          </div>

          <!-- 网站日志 -->
          <div v-show="activeMenu === 'log'" class="section">
            <div class="section-toolbar">
              <el-radio-group v-model="logForm.type">
                <el-radio-button value="access">访问日志</el-radio-button>
                <el-radio-button value="error">错误日志</el-radio-button>
              </el-radio-group>
              <el-select v-model="logForm.lines" style="width: 100px">
                <el-option v-for="n in [100, 200, 500, 1000]" :key="n" :value="n" :label="`${n} 行`" />
              </el-select>
              <el-button type="primary" :loading="logLoading" @click="loadSiteLogs">读取</el-button>
            </div>
            <pre class="code-box">{{ siteLogs || '点击「读取」查看日志' }}</pre>
          </div>
        </template>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  getProjectSettings,
  getProjectVhost,
  getSiteLogs,
  saveProjectSettings,
  type Project,
  type SiteSettings,
} from '@/api/projects'

const props = defineProps<{
  modelValue: boolean
  serverId: string
  project: Project | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const router = useRouter()
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const activeMenu = ref('domain')
const phpVersions = ref<string[]>([])
const sslDomain = ref('')

const isPhp = computed(() => props.project?.type === 'php')

const allMenus = [
  { key: 'domain', title: '域名管理' },
  { key: 'dir', title: '网站目录', phpOnly: true },
  { key: 'rewrite', title: '伪静态', phpOnly: true },
  { key: 'indexDoc', title: '默认文档', phpOnly: true },
  { key: 'access', title: '访问限制' },
  { key: 'leech', title: '防盗链', phpOnly: true },
  { key: 'redirect', title: '重定向' },
  { key: 'proxy', title: '反向代理', nonPhpOnly: true },
  { key: 'php', title: 'PHP版本', phpOnly: true },
  { key: 'ssl', title: 'SSL' },
  { key: 'config', title: '配置文件' },
  { key: 'log', title: '网站日志' },
]
const menus = computed(() =>
  allMenus.filter((m) => (m.phpOnly ? isPhp.value : m.nonPhpOnly ? !isPhp.value : true))
)

const rewritePresets = [
  { label: '不使用', value: 'none' },
  { label: 'ThinkPHP', value: 'thinkphp' },
  { label: 'Laravel', value: 'laravel' },
  { label: 'WordPress', value: 'wordpress' },
  { label: 'Typecho', value: 'typecho' },
  { label: 'Emlog', value: 'emlog' },
  { label: 'Discuz', value: 'discuz' },
  { label: '自定义', value: 'custom' },
]

const domainForm = reactive({ domains: [] as string[] })
const dirForm = reactive({ runDir: '' })
const rewriteForm = reactive({ preset: 'none', custom: '' })
const indexForm = reactive({ index: '' })
const accessForm = reactive({ allow: [] as string[], deny: [] as string[] })
const basicAuthForm = reactive({ enabled: false, username: '', password: '' })
const leechForm = reactive({ enabled: false, allowEmpty: true, referers: [] as string[] })
const redirectForm = reactive<{ from: string; to: string; type: number }[]>([])
const proxyForm = reactive({ enabled: false, target: '' })
const phpForm = reactive({ phpVersion: '' })
const configForm = reactive({ customSnippet: '' })

const vhost = ref('')
const vhostLoading = ref(false)
const siteLogs = ref('')
const logLoading = ref(false)
const logForm = reactive({ type: 'access' as 'access' | 'error', lines: 200 })

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible || !props.project || !props.serverId) return
    activeMenu.value = 'domain'
    loaded.value = false
    loading.value = true
    vhost.value = ''
    siteLogs.value = ''
    try {
      const res = await getProjectSettings(props.serverId, props.project.name)
      applySettings(res.settings)
      phpVersions.value = res.phpVersions || []
      sslDomain.value = res.sslDomain || ''
      loaded.value = true
    } finally {
      loading.value = false
    }
  }
)

function applySettings(s: SiteSettings) {
  domainForm.domains = [...(s.domains || [])]
  dirForm.runDir = s.runDir || ''
  rewriteForm.preset = s.rewrite?.preset || 'none'
  rewriteForm.custom = s.rewrite?.custom || ''
  indexForm.index = s.index || ''
  accessForm.allow = [...(s.access?.allow || [])]
  accessForm.deny = [...(s.access?.deny || [])]
  basicAuthForm.enabled = !!s.basicAuth?.enabled
  basicAuthForm.username = s.basicAuth?.username || ''
  basicAuthForm.password = ''
  leechForm.enabled = !!s.antiLeech?.enabled
  leechForm.allowEmpty = s.antiLeech?.allowEmpty !== false
  leechForm.referers = [...(s.antiLeech?.referers || [])]
  redirectForm.splice(0, redirectForm.length, ...(s.redirects || []).map((r) => ({ ...r })))
  proxyForm.enabled = !!s.proxy?.enabled
  proxyForm.target = s.proxy?.target || ''
  phpForm.phpVersion = s.phpVersion || ''
  configForm.customSnippet = s.customSnippet || ''
}

async function save(settings: Partial<SiteSettings>) {
  if (!props.project) return
  saving.value = true
  try {
    const res = await saveProjectSettings(props.serverId, props.project.name, settings)
    applySettings(res.settings)
    ElMessage.success('已保存并生效')
  } finally {
    saving.value = false
  }
}

function saveAccess() {
  save({
    access: { allow: accessForm.allow, deny: accessForm.deny },
    basicAuth: {
      enabled: basicAuthForm.enabled,
      username: basicAuthForm.username,
      ...(basicAuthForm.password ? { password: basicAuthForm.password } : {}),
    },
  })
}

async function loadVhost() {
  if (!props.project) return
  vhostLoading.value = true
  try {
    vhost.value = await getProjectVhost(props.serverId, props.project.name)
  } finally {
    vhostLoading.value = false
  }
}

async function loadSiteLogs() {
  if (!props.project) return
  logLoading.value = true
  try {
    siteLogs.value = await getSiteLogs(props.serverId, props.project.name, logForm.type, logForm.lines)
  } finally {
    logLoading.value = false
  }
}

function goSsl() {
  emit('update:modelValue', false)
  router.push('/ssl')
}
</script>

<style scoped lang="scss">
.settings-body {
  display: flex;
  height: 100%;
  min-height: 0;
}
.settings-menu {
  width: 160px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.settings-content {
  flex: 1;
  min-width: 0;
  padding: 16px;
  overflow-y: auto;
}
.section {
  max-width: 640px;
}
.tip {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 6px;
}
.section-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.section-actions {
  margin-top: 12px;
}
.redirect-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.code-box {
  max-height: 40vh;
}
</style>
