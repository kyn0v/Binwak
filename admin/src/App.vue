<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Layout from './components/Layout.vue'

const route = useRoute()
const showLayout = computed(() => route.path !== '/login')
</script>

<template>
  <Layout v-if="showLayout"><router-view /></Layout>
  <router-view v-else />
</template>
