import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/login/index.vue') },
    {
      path: '/',
      component: () => import('@/layout/index.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/index.vue'),
          meta: { title: '监控大盘' },
        },
        {
          path: 'servers',
          name: 'Servers',
          component: () => import('@/views/servers/index.vue'),
          meta: { title: '服务器管理' },
        },
        {
          path: 'databases',
          name: 'Databases',
          component: () => import('@/views/databases/index.vue'),
          meta: { title: '数据库管理' },
        },
        {
          path: 'store',
          name: 'Store',
          component: () => import('@/views/store/index.vue'),
          meta: { title: '软件商店' },
        },
        {
          path: 'disk',
          name: 'Disk',
          component: () => import('@/views/disk/index.vue'),
          meta: { title: '磁盘管理' },
        },
        {
          path: 'supervisor',
          name: 'Supervisor',
          component: () => import('@/views/supervisor/index.vue'),
          meta: { title: '进程守护' },
        },
        {
          path: 'projects',
          name: 'Projects',
          component: () => import('@/views/projects/index.vue'),
          meta: { title: '项目' },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('linuxmgr_token')
  if (!token && to.path !== '/login') return '/login'
  if (token && to.path === '/login') return '/'
  return true
})

export default router
