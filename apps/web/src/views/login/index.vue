<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="brand">
        <div class="brand-name">云小U</div>
        <div class="brand-sub">服务器管理面板</div>
      </div>
      <el-form :model="form" @keyup.enter="onSubmit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" size="large" class="submit" :loading="loading" @click="onSubmit">
          登 录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const form = reactive({ username: '', password: '' })
const loading = ref(false)

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await userStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(59, 111, 224, 0.35), transparent),
    radial-gradient(ellipse 50% 40% at 85% 85%, rgba(43, 90, 160, 0.4), transparent),
    linear-gradient(135deg, #0f1f3d, #1f3b73);
}
.login-card {
  width: min(440px, 92vw);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  animation: rise 0.4s ease-out;
  :deep(.el-card__body) { padding: 36px 36px 28px; }
  .brand { text-align: center; margin-bottom: 28px; }
  .brand-name { font-size: 26px; font-weight: 700; color: var(--brand); letter-spacing: 2px; }
  .brand-sub { margin-top: 6px; font-size: 13px; color: var(--text-3); }
  .submit { width: 100%; letter-spacing: 4px; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
