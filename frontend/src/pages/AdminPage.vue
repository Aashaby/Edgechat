<script setup>
import { RouterView } from 'vue-router';
import AdminSidebar from '../components/admin/AdminSidebar.vue';
import AdminTopbar from '../components/admin/AdminTopbar.vue';
import { useAdminAnchorScroll } from '../composables/useAdminAnchorScroll.js';

useAdminAnchorScroll();
</script>

<template>
  <div class="admin-page">
    <AdminSidebar />
    <section class="admin-workspace">
      <AdminTopbar />
      <main class="admin-content">
        <RouterView />
      </main>
    </section>
  </div>
</template>
