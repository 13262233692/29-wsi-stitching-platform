<template>
  <div class="app-container">
    <AppHeader />
    <div class="main-content">
      <el-container>
        <el-aside width="220px" class="app-aside">
          <el-menu
            :default-active="activeMenu"
            router
            background-color="transparent"
            text-color="#b0c4de"
            active-text-color="#409eff"
            class="nav-menu"
          >
            <el-menu-item index="/dashboard">
              <el-icon><DataAnalysis /></el-icon>
              <span>总览大屏</span>
            </el-menu-item>
            <el-menu-item index="/tasks">
              <el-icon><List /></el-icon>
              <span>任务管理</span>
            </el-menu-item>
            <el-menu-item index="/viewer">
              <el-icon><Picture /></el-icon>
              <span>图像大屏</span>
            </el-menu-item>
            <el-menu-item index="/system">
              <el-icon><Setting /></el-icon>
              <span>系统设置</span>
            </el-menu-item>
          </el-menu>
        </el-aside>
        <el-main class="app-main">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from './components/AppHeader.vue';

const route = useRoute();
const activeMenu = computed(() => route.path);
</script>

<style scoped lang="scss">
.main-content {
  flex: 1;
  min-height: 0;
}
.app-aside {
  background: rgba(15, 22, 40, 0.5);
  border-right: 1px solid rgba(64, 158, 255, 0.1);
  padding-top: 12px;
}
.app-main {
  padding: 16px;
  height: calc(100vh - 64px);
  overflow: auto;
}
.nav-menu {
  border-right: none !important;
  :deep(.el-menu-item) {
    height: 48px;
    line-height: 48px;
    margin: 4px 12px;
    border-radius: 6px;
    &.is-active {
      background: rgba(64, 158, 255, 0.12);
    }
    &:hover {
      background: rgba(64, 158, 255, 0.08);
    }
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
