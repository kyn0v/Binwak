import { createRouter, createWebHashHistory } from 'vue-router'
import { getToken } from './api'

import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Users from './views/Users.vue'
import UserDetail from './views/UserDetail.vue'
import Templates from './views/Templates.vue'
import WordBank from './views/WordBank.vue'
import GenerateTemplate from './views/GenerateTemplate.vue'
import System from './views/System.vue'

export const router = createRouter({
  history: createWebHashHistory('/admin/'),
  routes: [
    { path: '/login', component: Login },
    { path: '/', component: Dashboard, meta: { auth: true } },
    { path: '/users', component: Users, meta: { auth: true } },
    { path: '/users/:id', component: UserDetail, meta: { auth: true }, props: true },
    { path: '/templates', component: Templates, meta: { auth: true } },
    { path: '/wordbank', component: WordBank, meta: { auth: true } },
    { path: '/generate', component: GenerateTemplate, meta: { auth: true } },
    { path: '/system', component: System, meta: { auth: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.auth && !getToken()) {
    return '/login'
  }
})
