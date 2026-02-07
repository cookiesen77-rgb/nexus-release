/**
 * Router configuration | 路由配置
 */
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue')
  },
  {
    path: '/canvas/:id?',
    name: 'Canvas',
    component: () => import('../views/Canvas.vue')
  }
]

const isDesktop = ['electron', 'tauri'].includes(import.meta.env.MODE)

const router = createRouter({
  history: isDesktop
    ? createWebHashHistory()
    : createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
