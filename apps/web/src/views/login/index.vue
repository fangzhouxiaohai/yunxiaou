<template>
  <div class="login-page">
    <div class="brand-side" :style="{ backgroundImage: `url(${bgUrl})` }">
      <div class="brand-mask"></div>
      <div class="brand-content">
        <div class="brand-name">云小U</div>
        <div class="brand-sub">服务器管理面板</div>
        <ul class="feature-list">
          <li>多服务器集中管理</li>
          <li>网站与数据库一站式运维</li>
          <li>安全可靠 · 操作留痕</li>
        </ul>
      </div>
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
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import bgUrl from '@/assets/login-city.jpg'

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
  background: var(--bg-card);
}
.brand-side {
  flex: 1;
  position: relative;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  overflow: hidden;
  .brand-mask {
    position: absolute;
    inset: 0;
    background: linear-gradient(120deg, rgba(8, 18, 38, 0.82) 0%, rgba(8, 18, 38, 0.45) 55%, rgba(8, 18, 38, 0.25) 100%);
  }
  .brand-content {
    position: relative;
    padding: 0 64px;
    color: #ffffff;
    animation: rise 0.5s ease-out;
  }
  .brand-name {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: 6px;
    text-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
  }
  .brand-sub {
    margin-top: 12px;
    font-size: 16px;
    letter-spacing: 2px;
    color: rgba(255, 255, 255, 0.85);
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .feature-list {
    margin-top: 44px;
    list-style: none;
    li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 16px;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 7px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #8fb0f2;
        box-shadow: 0 0 6px rgba(143, 176, 242, 0.9);
      }
    }
  }
}
.form-side {
  width: 440px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 48px;
  background: var(--bg-card);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
  position: relative;
  z-index: 1;
  .form-inner { width: 100%; }
  .form-title { font-size: 24px; font-weight: 600; color: var(--text-1); }
  .form-tip { margin: 8px 0 28px; font-size: 13px; color: var(--text-3); }
  .submit { width: 100%; letter-spacing: 4px; }
}
@media (max-width: 767px) {
  .login-page {
    flex-direction: column;
    background-size: cover;
    background-position: center;
  }
  .brand-side {
    flex: none;
    width: 100%;
    padding: 40px 24px 28px;
    .brand-content { padding: 0; }
    .brand-name { font-size: 30px; letter-spacing: 3px; }
    .feature-list { display: none; }
  }
  .form-side {
    width: 100%;
    flex: 1;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.18);
    border-radius: 16px 16px 0 0;
  }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
