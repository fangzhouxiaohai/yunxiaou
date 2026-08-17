<template>
  <div class="login-page">
    <div class="login-panel">
      <div class="brand-side">
        <div class="brand-name">云小U</div>
        <div class="brand-sub">服务器管理面板</div>
        <ul class="feature-list">
          <li>多服务器集中管理</li>
          <li>网站与数据库一站式运维</li>
          <li>安全可靠 · 操作留痕</li>
        </ul>
      </div>
      <div class="form-side">
        <div class="form-inner">
          <div class="form-title">欢迎登录</div>
          <div class="form-tip">请使用管理员账号登录系统</div>
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
        </div>
      </div>
    </div>
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
.login-panel {
  display: flex;
  width: min(880px, 94vw);
  height: min(560px, 82vh);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  animation: rise 0.4s ease-out;
}
.brand-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px;
  color: #ffffff;
  background:
    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(92, 135, 230, 0.35), transparent),
    radial-gradient(ellipse 50% 45% at 90% 90%, rgba(43, 90, 160, 0.5), transparent),
    linear-gradient(150deg, #0f1f3d, #1f3b73);
  position: relative;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 32px),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 32px);
    pointer-events: none;
  }
  .brand-name { font-size: 28px; font-weight: 700; letter-spacing: 2px; }
  .brand-sub { margin-top: 8px; font-size: 14px; color: rgba(255, 255, 255, 0.75); }
  .feature-list {
    margin-top: 36px;
    list-style: none;
    li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 14px;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.85);
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 7px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #8fb0f2;
      }
    }
  }
}
.form-side {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 36px;
  background: var(--bg-card);
  .form-inner { width: 100%; }
  .form-title { font-size: 20px; font-weight: 600; color: var(--text-1); }
  .form-tip { margin: 6px 0 24px; font-size: 13px; color: var(--text-3); }
  .submit { width: 100%; letter-spacing: 4px; }
}
@media (max-width: 767px) {
  .brand-side { display: none; }
  .login-panel { height: auto; min-height: 380px; }
  .form-side { width: 100%; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
