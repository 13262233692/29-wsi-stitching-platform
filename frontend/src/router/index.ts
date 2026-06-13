import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: '总览大屏' },
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import('@/views/TaskManagement.vue'),
    meta: { title: '任务管理' },
  },
  {
    path: '/viewer',
    name: 'Viewer',
    component: () => import('@/views/ImageViewer.vue'),
    meta: { title: '图像大屏' },
  },
  {
    path: '/viewer/:taskId',
    name: 'ViewerWithTask',
    component: () => import('@/views/ImageViewer.vue'),
    meta: { title: '图像大屏' },
  },
  {
    path: '/system',
    name: 'System',
    component: () => import('@/views/SystemSettings.vue'),
    meta: { title: '系统设置' },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to, _from, next) => {
  if (to.meta?.title) {
    document.title = `${to.meta.title} - WSI 拼接控制台`;
  }
  next();
});

export default router;
